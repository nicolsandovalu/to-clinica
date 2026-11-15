/**
 * Contrato de `IRepositorioClinico`. Las mismas pruebas corren contra la
 * implementación en memoria y contra la de SQLite (con el SQL real), para
 * garantizar que se comportan igual.
 */
import { ErrorRepositorio, IRepositorioClinico } from '../src/data/repositorio';
import type { InstantaneaServidor } from '../src/data/tipos';
import {
  DependenciasPrueba,
  PATRON_UUID_V4,
  crearDependencias,
  crearRepositorioMemoria,
  crearRepositorioSQLitePrueba,
} from './ayudas/entorno';

const PROPIETARIA = '1';

const implementaciones: [string, (deps: DependenciasPrueba) => IRepositorioClinico][] = [
  ['RepositorioMemoria', (deps) => crearRepositorioMemoria(deps)],
  ['RepositorioSQLite', (deps) => crearRepositorioSQLitePrueba(deps).repositorio],
];

describe.each(implementaciones)('%s', (_nombre, crear) => {
  let deps: DependenciasPrueba;
  let repo: IRepositorioClinico;

  beforeEach(async () => {
    deps = crearDependencias();
    repo = crear(deps);
    await repo.inicializar();
  });

  afterEach(async () => {
    await repo.cerrar();
  });

  async function crearCadena() {
    const apoderado = await repo.crearApoderado({
      propietaria_id: PROPIETARIA,
      nombre: 'Apoderada Uno',
      telefono: '+56912345678',
    });
    const paciente = await repo.crearPaciente({
      propietaria_id: PROPIETARIA,
      apoderado_id: apoderado.id,
      nombre: 'Paciente Uno',
      fecha_nacimiento: '2019-05-20',
    });
    const cita = await repo.crearCita({
      paciente_id: paciente.id,
      fecha_hora: '2026-03-10T15:00:00.000Z',
    });
    const registro = await repo.crearRegistroSesion({
      cita_id: cita.id,
      observaciones: 'Observación de prueba',
    });
    return { apoderado, paciente, cita, registro };
  }

  describe('persistencia transaccional en cola_sync', () => {
    it('guarda el registro como pendiente y encola una operación con op_id UUID v4', async () => {
      const paciente = await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: '  Ana  ' });

      expect(paciente.id).toMatch(PATRON_UUID_V4);
      expect(paciente.nombre).toBe('Ana');
      expect(paciente.estado_sync).toBe('pendiente');
      expect(paciente.archivado).toBe(false);
      expect(await repo.obtenerPaciente(paciente.id)).toEqual(paciente);

      const cola = await repo.listarColaSync();
      expect(cola).toHaveLength(1);
      const [operacion] = cola;
      expect(operacion?.op_id).toMatch(PATRON_UUID_V4);
      expect(operacion?.op_id).not.toBe(paciente.id);
      expect(operacion).toMatchObject({
        entidad: 'paciente',
        registro_id: paciente.id,
        operacion: 'crear',
        modificado_en: paciente.modificado_en,
        intentos: 0,
      });
      const { estado_sync: _estado, ...datosEsperados } = paciente;
      expect(operacion?.datos).toEqual(datosEsperados);
      expect(operacion?.datos).not.toHaveProperty('estado_sync');
    });

    it('cada escritura de cada entidad encola exactamente una operación', async () => {
      const { apoderado, paciente, cita, registro } = await crearCadena();
      await repo.actualizarApoderado(apoderado.id, { telefono: null });
      await repo.actualizarPaciente(paciente.id, { motivo_consulta: 'Motivo' });
      await repo.actualizarCita(cita.id, { estado: 'confirmada' });
      await repo.actualizarRegistroSesion(registro.id, { objetivos_cumplidos: 'Objetivo' });
      await repo.archivarRegistroSesion(registro.id);
      await repo.archivarPaciente(paciente.id);

      const cola = await repo.listarColaSync();
      expect(cola.map((op) => `${op.entidad}:${op.operacion}`)).toEqual([
        'apoderado:crear',
        'apoderado:actualizar',
        'paciente:crear',
        'paciente:actualizar',
        'paciente:archivar',
        'cita:crear',
        'cita:actualizar',
        'registro_sesion:crear',
        'registro_sesion:actualizar',
        'registro_sesion:archivar',
      ]);
      expect(new Set(cola.map((op) => op.op_id)).size).toBe(cola.length);
    });

    it('si falla la inserción en la cola, tampoco queda guardado el registro (rollback)', async () => {
      deps.fallarUuidEnLlamada(2); // 1.ª: id del paciente; 2.ª: op_id
      await expect(
        repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'No debe quedar' }),
      ).rejects.toThrow('fallo simulado');

      expect(await repo.listarPacientes({ incluirArchivados: true })).toEqual([]);
      expect(await repo.listarColaSync()).toEqual([]);
      expect(await repo.estaVacio()).toBe(true);
    });

    it('si falla la cola al actualizar o archivar, el registro conserva su valor anterior', async () => {
      const original = await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Original' });

      deps.fallarUuidEnLlamada(1);
      await expect(repo.actualizarPaciente(original.id, { nombre: 'Cambiado' })).rejects.toThrow();
      deps.fallarUuidEnLlamada(1);
      await expect(repo.archivarPaciente(original.id)).rejects.toThrow();

      expect(await repo.obtenerPaciente(original.id)).toEqual(original);
      expect(await repo.listarColaSync()).toHaveLength(1);
    });

    it('el repositorio sigue funcionando después de una transacción fallida', async () => {
      deps.fallarUuidEnLlamada(2);
      await expect(repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'X' })).rejects.toThrow();
      const paciente = await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Y' });
      expect(await repo.obtenerPaciente(paciente.id)).not.toBeNull();
      expect(await repo.listarColaSync()).toHaveLength(1);
    });

    it('devuelve la cola en el orden Apoderado -> Paciente -> Cita -> RegistroSesion', async () => {
      const paciente = await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Primero' });
      const cita = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: '2026-03-10T15:00:00Z' });
      await repo.crearRegistroSesion({ cita_id: cita.id });
      const apoderado = await repo.crearApoderado({ propietaria_id: PROPIETARIA, nombre: 'Después' });
      await repo.actualizarPaciente(paciente.id, { apoderado_id: apoderado.id });
      await repo.registrarAceptacionPolitica({ version: '1.0' });

      const cola = await repo.listarColaSync();
      expect(cola.map((op) => op.entidad)).toEqual([
        'aceptacion_politica',
        'apoderado',
        'paciente',
        'paciente',
        'cita',
        'registro_sesion',
      ]);
      expect(cola.filter((op) => op.entidad === 'paciente').map((op) => op.operacion)).toEqual([
        'crear',
        'actualizar',
      ]);
    });

    it('confirmar una operación la retira y marca sincronizado solo si no quedan otras', async () => {
      const paciente = await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Ana' });
      await repo.actualizarPaciente(paciente.id, { antecedentes: 'Texto' });
      const [crear, actualizar] = await repo.listarColaSync();

      await repo.confirmarOperacionSync(crear?.op_id ?? '');
      expect((await repo.obtenerPaciente(paciente.id))?.estado_sync).toBe('pendiente');

      await repo.confirmarOperacionSync(actualizar?.op_id ?? '');
      expect((await repo.obtenerPaciente(paciente.id))?.estado_sync).toBe('sincronizado');
      expect(await repo.listarColaSync()).toEqual([]);

      await repo.actualizarPaciente(paciente.id, { antecedentes: 'Otro' });
      expect((await repo.obtenerPaciente(paciente.id))?.estado_sync).toBe('pendiente');
    });

    it('cuenta los intentos fallidos de una operación', async () => {
      await repo.crearApoderado({ propietaria_id: PROPIETARIA, nombre: 'Apoderada' });
      const [operacion] = await repo.listarColaSync();
      await repo.registrarIntentoFallido(operacion?.op_id ?? '');
      await repo.registrarIntentoFallido(operacion?.op_id ?? '');
      expect((await repo.listarColaSync())[0]?.intentos).toBe(2);
    });
  });

  describe('sin eliminación física', () => {
    it('no expone ningún método de eliminación', () => {
      const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(repo));
      expect(metodos.filter((nombre) => /elimin|borr|delete|remove/i.test(nombre))).toEqual([]);
      expect(metodos).toEqual(expect.arrayContaining(['archivarPaciente', 'archivarRegistroSesion']));
    });

    it('archivar conserva el registro y lo oculta de la lista por defecto', async () => {
      const { paciente, registro } = await crearCadena();
      const pacienteArchivado = await repo.archivarPaciente(paciente.id);
      const registroArchivado = await repo.archivarRegistroSesion(registro.id);

      expect(pacienteArchivado.archivado).toBe(true);
      expect(pacienteArchivado.modificado_en > paciente.modificado_en).toBe(true);
      expect(registroArchivado.archivado).toBe(true);
      expect(await repo.obtenerPaciente(paciente.id)).toEqual(pacienteArchivado);
      expect(await repo.obtenerRegistroSesion(registro.id)).toEqual(registroArchivado);
      expect(await repo.listarPacientes()).toEqual([]);
      expect(await repo.listarPacientes({ incluirArchivados: true })).toHaveLength(1);
    });
  });

  describe('restricciones', () => {
    async function esperarError(promesa: Promise<unknown>, codigo: string) {
      const colaAntes = await repo.listarColaSync();
      await expect(promesa).rejects.toMatchObject({ name: 'ErrorRepositorio', codigo });
      expect(await repo.listarColaSync()).toEqual(colaAntes);
    }

    it('exige nombre en paciente y apoderado', async () => {
      await esperarError(repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: '   ' }), 'validacion');
      await esperarError(repo.crearApoderado({ propietaria_id: PROPIETARIA, nombre: '' }), 'validacion');
    });

    it.each(['912345678', '+5691234567', '+569123456789', '+56812345678', '+569abcdefgh'])(
      'rechaza el teléfono %s',
      async (telefono) => {
        await esperarError(
          repo.crearApoderado({ propietaria_id: PROPIETARIA, nombre: 'Apoderada', telefono }),
          'validacion',
        );
      },
    );

    it('acepta teléfono +569XXXXXXXX o vacío', async () => {
      const con = await repo.crearApoderado({
        propietaria_id: PROPIETARIA,
        nombre: 'Con',
        telefono: '+56987654321',
      });
      const sin = await repo.crearApoderado({ propietaria_id: PROPIETARIA, nombre: 'Sin' });
      expect(con.telefono).toBe('+56987654321');
      expect(sin.telefono).toBeNull();
    });

    it('solo admite los estados de cita definidos', async () => {
      const { cita } = await crearCadena();
      await esperarError(
        repo.actualizarCita(cita.id, { estado: 'eliminada' as never }),
        'validacion',
      );
      for (const estado of ['pendiente', 'confirmada', 'cancelada', 'sin_respuesta'] as const) {
        expect((await repo.actualizarCita(cita.id, { estado })).estado).toBe(estado);
      }
    });

    it('una cita admite un único registro de sesión (UNIQUE cita_id)', async () => {
      const { cita, registro } = await crearCadena();
      await esperarError(repo.crearRegistroSesion({ cita_id: cita.id }), 'duplicado');
      expect(await repo.obtenerRegistroSesionPorCita(cita.id)).toEqual(registro);
    });

    it('rechaza referencias a registros inexistentes', async () => {
      const inexistente = '00000000-0000-4000-8000-000000000000';
      await esperarError(
        repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Ana', apoderado_id: inexistente }),
        'no_encontrado',
      );
      await esperarError(
        repo.crearCita({ paciente_id: inexistente, fecha_hora: '2026-03-10T15:00:00Z' }),
        'no_encontrado',
      );
      await esperarError(repo.crearRegistroSesion({ cita_id: inexistente }), 'no_encontrado');
      await esperarError(repo.archivarPaciente(inexistente), 'no_encontrado');
      await esperarError(repo.actualizarCita(inexistente, { estado: 'confirmada' }), 'no_encontrado');
    });

    it('rechaza fechas inválidas', async () => {
      const { paciente } = await crearCadena();
      await esperarError(repo.crearCita({ paciente_id: paciente.id, fecha_hora: 'mañana' }), 'validacion');
      await esperarError(
        repo.actualizarPaciente(paciente.id, { fecha_nacimiento: '2019-02-30' }),
        'validacion',
      );
    });
  });

  describe('consultas', () => {
    it('lista las citas de un rango ordenadas por fecha', async () => {
      const paciente = await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Ana' });
      const tarde = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: '2026-03-10T18:00:00Z' });
      const temprano = await repo.crearCita({
        paciente_id: paciente.id,
        fecha_hora: '2026-03-10T09:00:00-03:00',
      });
      await repo.crearCita({ paciente_id: paciente.id, fecha_hora: '2026-03-11T12:00:00Z' });

      const delDia = await repo.listarCitasEntre('2026-03-10T00:00:00Z', '2026-03-11T00:00:00Z');
      expect(delDia.map((c) => c.id)).toEqual([temprano.id, tarde.id]);
      expect(temprano.fecha_hora).toBe('2026-03-10T12:00:00.000Z');
      expect(await repo.listarCitasDePaciente(paciente.id)).toHaveLength(3);
    });

    it('lista pacientes y apoderados por nombre', async () => {
      await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Zoe' });
      await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Ana' });
      await repo.crearApoderado({ propietaria_id: PROPIETARIA, nombre: 'Beto' });
      expect((await repo.listarPacientes()).map((p) => p.nombre)).toEqual(['Ana', 'Zoe']);
      expect((await repo.listarApoderados()).map((a) => a.nombre)).toEqual(['Beto']);
    });
  });

  describe('política de privacidad', () => {
    it('registra versión y fecha, y encola su sincronización', async () => {
      expect(await repo.obtenerAceptacionPolitica('1.0')).toBeNull();
      const aceptacion = await repo.registrarAceptacionPolitica({ version: '1.0' });

      expect(aceptacion).toMatchObject({ version: '1.0', usuaria_id: null, estado_sync: 'pendiente' });
      expect(Number.isNaN(Date.parse(aceptacion.aceptada_en))).toBe(false);
      expect(await repo.obtenerAceptacionPolitica('1.0')).toEqual(aceptacion);
      expect(await repo.obtenerAceptacionPolitica('2.0')).toBeNull();
      expect(await repo.listarColaSync()).toMatchObject([
        { entidad: 'aceptacion_politica', registro_id: aceptacion.id, operacion: 'crear' },
      ]);
      // La aceptación no es un dato clínico: el repositorio sigue "vacío" para la restauración.
      expect(await repo.estaVacio()).toBe(true);
    });
  });

  describe('eventos de sincronización', () => {
    it('guarda solo metadatos, aunque se le entregue contenido extra', async () => {
      const conExtra = {
        tipo: 'envio_error' as const,
        entidad: 'paciente' as const,
        registro_id: 'r1',
        op_id: 'o1',
        codigo_http: 500,
        observaciones: 'CONTENIDO CLINICO',
      };
      const evento = await repo.registrarEventoSync(conExtra);
      const eventos = await repo.listarEventosSync();

      expect(eventos).toEqual([evento]);
      expect(Object.keys(evento).sort()).toEqual(
        ['codigo_http', 'entidad', 'evento_id', 'ocurrido_en', 'op_id', 'registro_id', 'tipo'].sort(),
      );
      expect(JSON.stringify(eventos)).not.toContain('CONTENIDO CLINICO');
    });
  });

  describe('restauración desde el servidor', () => {
    const instantanea: InstantaneaServidor = {
      apoderados: [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', propietaria_id: PROPIETARIA, nombre: 'Apo', telefono: null },
      ],
      pacientes: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          propietaria_id: PROPIETARIA,
          apoderado_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          nombre: 'Paciente restaurado',
          fecha_nacimiento: null,
          antecedentes: '',
          motivo_consulta: '',
          archivado: true,
          creado_en: '2025-01-01T10:00:00.000Z',
          modificado_en: '2025-06-01T10:00:00.000Z',
        },
      ],
      citas: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          paciente_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          fecha_hora: '2025-02-01T15:00:00.000Z',
          estado: 'confirmada',
          creado_en: '2025-01-01T10:00:00.000Z',
          modificado_en: '2025-01-01T10:00:00.000Z',
        },
      ],
      registros_sesion: [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          cita_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          observaciones: 'Obs',
          objetivos_cumplidos: '',
          retroalimentacion_familia: '',
          archivado: false,
          creado_en: '2025-02-01T16:00:00.000Z',
          modificado_en: '2025-02-01T16:00:00.000Z',
        },
      ],
    };

    it('carga todo como sincronizado y sin encolar nada', async () => {
      await repo.restaurarDesdeServidor(instantanea);

      expect(await repo.estaVacio()).toBe(false);
      expect(await repo.listarColaSync()).toEqual([]);
      const [paciente] = await repo.listarPacientes({ incluirArchivados: true });
      expect(paciente).toEqual({ ...instantanea.pacientes[0], estado_sync: 'sincronizado' });
      expect((await repo.obtenerRegistroSesionPorCita('cccccccc-cccc-4ccc-8ccc-cccccccccccc'))?.estado_sync).toBe(
        'sincronizado',
      );
      expect(await repo.listarApoderados()).toHaveLength(1);
    });

    it('se niega a restaurar sobre datos locales existentes', async () => {
      await repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre: 'Local' });
      await expect(repo.restaurarDesdeServidor(instantanea)).rejects.toMatchObject({ codigo: 'no_vacio' });
      expect(await repo.listarPacientes({ incluirArchivados: true })).toHaveLength(1);
    });

    it.each<[string, unknown]>([
      ['cita con paciente inexistente', { ...instantanea, pacientes: [] }],
      ['estado de cita desconocido', { ...instantanea, citas: [{ ...instantanea.citas[0], estado: 'otro' }] }],
      [
        'dos registros para la misma cita',
        {
          ...instantanea,
          registros_sesion: [
            instantanea.registros_sesion[0],
            { ...instantanea.registros_sesion[0], id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
          ],
        },
      ],
      ['respuesta sin listas', { pacientes: 'x' }],
    ])('rechaza completa una instantánea inválida: %s', async (_caso, invalida) => {
      await expect(repo.restaurarDesdeServidor(invalida as InstantaneaServidor)).rejects.toBeInstanceOf(
        ErrorRepositorio,
      );
      expect(await repo.estaVacio()).toBe(true);
      expect(await repo.listarApoderados()).toEqual([]);
    });
  });
});
