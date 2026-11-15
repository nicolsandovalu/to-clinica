import type { IRepositorioClinico } from '../src/data/repositorio';
import {
  ORDEN_RESUMEN_SESION,
  archivarPaciente,
  combinarFechaHora,
  filtrarPacientes,
  guardarPacienteConApoderado,
  listarCitasDelDia,
  obtenerResumenUltimaSesion,
} from '../src/modules/pacientes-agenda/servicio';
import { normalizarYValidarTelefonoChileno } from '../src/modules/pacientes-agenda/validaciones';
import {
  construirEnlaceConfirmacionWhatsApp,
  construirMensajeConfirmacion,
} from '../src/modules/pacientes-agenda/whatsapp';
import { crearRepositorioMemoria } from './ayudas/entorno';

const PROPIETARIA = '1';

describe('normalizarYValidarTelefonoChileno', () => {
  it('acepta +569 con 8 dígitos y limpia espacios externos', () => {
    expect(normalizarYValidarTelefonoChileno('  +56912345678 ')).toEqual({
      valido: true,
      telefono: '+56912345678',
      error: null,
    });
  });

  it('es opcional: vacío o solo espacios se normaliza a null', () => {
    for (const entrada of ['', '   ', null, undefined]) {
      expect(normalizarYValidarTelefonoChileno(entrada)).toEqual({
        valido: true,
        telefono: null,
        error: null,
      });
    }
  });

  it.each([
    '56912345678',
    '+5621234567',
    '+5691234567',
    '+569123456789',
    '+569 1234 5678',
    '+56912345a78',
    '+56912345678\n+56911111111',
  ])('rechaza %j', (entrada) => {
    const r = normalizarYValidarTelefonoChileno(entrada);
    expect(r.valido).toBe(false);
    expect(r.telefono).toBeNull();
    expect(r.error).not.toBeNull();
  });
});

describe('construirEnlaceConfirmacionWhatsApp', () => {
  const fecha = new Date(2026, 2, 5, 9, 5); // hora local, independiente de la zona horaria

  it('usa wa.me sin "+" y el texto codificado con encodeURIComponent', () => {
    const enlace = construirEnlaceConfirmacionWhatsApp('+56912345678', 'Ana Pérez', fecha) ?? '';
    expect(enlace.startsWith('https://wa.me/56912345678?text=')).toBe(true);
    const texto = enlace.split('?text=')[1] ?? '';
    expect(texto).toBe(encodeURIComponent(construirMensajeConfirmacion('Ana Pérez', fecha)));
    expect(decodeURIComponent(texto)).toBe(
      'Hola, le escribo para confirmar la cita de Ana Pérez el 05/03/2026 a las 09:05. ¿Nos confirma su asistencia?',
    );
    expect(texto).not.toMatch(/[ ¿?,]/);
  });

  it('no incluye datos clínicos: solo saludo, nombre y fecha/hora', () => {
    const mensaje = construirMensajeConfirmacion('Ana', fecha).toLowerCase();
    for (const prohibida of ['motivo', 'antecedente', 'observacion', 'objetivo', 'diagnos']) {
      expect(mensaje).not.toContain(prohibida);
    }
  });

  it('devuelve null con teléfono ausente o inválido', () => {
    expect(construirEnlaceConfirmacionWhatsApp(null, 'Ana', fecha)).toBeNull();
    expect(construirEnlaceConfirmacionWhatsApp('', 'Ana', fecha)).toBeNull();
    expect(construirEnlaceConfirmacionWhatsApp('12345', 'Ana', fecha)).toBeNull();
  });

  it('un nombre con caracteres especiales no rompe la URL', () => {
    const enlace = construirEnlaceConfirmacionWhatsApp('+56912345678', 'A&B=C#1', fecha) ?? '';
    expect(enlace.split('?text=')).toHaveLength(2);
    expect(enlace).not.toMatch(/&|#/);
  });
});

describe('agenda y pacientes sobre el repositorio', () => {
  let repo: IRepositorioClinico;

  beforeEach(async () => {
    repo = crearRepositorioMemoria();
    await repo.inicializar();
  });

  async function nuevoPaciente(nombre: string) {
    return repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre });
  }

  it('lista las citas del día ordenadas por fecha_hora y sin pacientes archivados', async () => {
    const ana = await nuevoPaciente('Ana');
    const beto = await nuevoPaciente('Beto');
    const archivado = await nuevoPaciente('Carla');
    const tarde = new Date(2026, 5, 10, 16, 0).toISOString();
    const manana = new Date(2026, 5, 10, 9, 0).toISOString();
    const otroDia = new Date(2026, 5, 11, 9, 0).toISOString();
    await repo.crearCita({ paciente_id: ana.id, fecha_hora: tarde });
    await repo.crearCita({ paciente_id: beto.id, fecha_hora: manana });
    await repo.crearCita({ paciente_id: ana.id, fecha_hora: otroDia });
    await repo.crearCita({ paciente_id: archivado.id, fecha_hora: manana });
    await archivarPaciente(repo, archivado.id);

    const citas = await listarCitasDelDia(repo, new Date(2026, 5, 10, 12, 0));
    expect(citas.map((c) => c.paciente.nombre)).toEqual(['Beto', 'Ana']);
  });

  it('cambiar el estado de la cita queda pendiente de sincronizar', async () => {
    const ana = await nuevoPaciente('Ana');
    const cita = await repo.crearCita({ paciente_id: ana.id, fecha_hora: new Date().toISOString() });
    const actualizada = await repo.actualizarCita(cita.id, { estado: 'confirmada' });
    expect(actualizada.estado).toBe('confirmada');
    expect(actualizada.estado_sync).toBe('pendiente');
  });

  describe('resumen de la última sesión', () => {
    it('sin sesiones devuelve null', async () => {
      const ana = await nuevoPaciente('Ana');
      await repo.crearCita({ paciente_id: ana.id, fecha_hora: new Date().toISOString() });
      expect(await obtenerResumenUltimaSesion(repo, ana.id)).toBeNull();
    });

    it('orden estricto: objetivos, retroalimentación de la familia, observaciones', async () => {
      expect(ORDEN_RESUMEN_SESION.map((s) => s.titulo)).toEqual([
        'Objetivos cumplidos',
        'Retroalimentación de la familia',
        'Observaciones',
      ]);
      const ana = await nuevoPaciente('Ana');
      const cita = await repo.crearCita({
        paciente_id: ana.id,
        fecha_hora: new Date(2026, 4, 1, 10, 0).toISOString(),
      });
      await repo.crearRegistroSesion({
        cita_id: cita.id,
        observaciones: 'OBS',
        objetivos_cumplidos: 'OBJ',
        retroalimentacion_familia: 'FAM',
      });
      const resumen = await obtenerResumenUltimaSesion(repo, ana.id);
      expect(resumen?.secciones).toEqual([
        { titulo: 'Objetivos cumplidos', texto: 'OBJ' },
        { titulo: 'Retroalimentación de la familia', texto: 'FAM' },
        { titulo: 'Observaciones', texto: 'OBS' },
      ]);
    });

    it('toma la sesión más reciente y omite registros archivados', async () => {
      const ana = await nuevoPaciente('Ana');
      const vieja = await repo.crearCita({
        paciente_id: ana.id,
        fecha_hora: new Date(2026, 3, 1, 10, 0).toISOString(),
      });
      const nueva = await repo.crearCita({
        paciente_id: ana.id,
        fecha_hora: new Date(2026, 4, 1, 10, 0).toISOString(),
      });
      await repo.crearRegistroSesion({ cita_id: vieja.id, objetivos_cumplidos: 'VIEJA' });
      const registroNuevo = await repo.crearRegistroSesion({
        cita_id: nueva.id,
        objetivos_cumplidos: 'NUEVA',
      });
      expect((await obtenerResumenUltimaSesion(repo, ana.id))?.secciones[0]?.texto).toBe('NUEVA');

      await repo.archivarRegistroSesion(registroNuevo.id);
      expect((await obtenerResumenUltimaSesion(repo, ana.id))?.secciones[0]?.texto).toBe('VIEJA');
    });
  });

  describe('archivado de pacientes', () => {
    it('archivar no elimina: el paciente se conserva pero sale de la lista activa', async () => {
      const ana = await nuevoPaciente('Ana');
      const archivada = await archivarPaciente(repo, ana.id);
      expect(archivada.archivado).toBe(true);
      expect(await repo.obtenerPaciente(ana.id)).not.toBeNull();
      expect(await repo.listarPacientes()).toHaveLength(0);
      expect(await repo.listarPacientes({ incluirArchivados: true })).toHaveLength(1);
    });

    it('el repositorio no expone operaciones de borrado de entidades clínicas', () => {
      const nombres = Object.getOwnPropertyNames(Object.getPrototypeOf(repo));
      expect(nombres.filter((n) => /^(eliminar|borrar|delete|remove)/i.test(n))).toEqual([]);
    });
  });

  describe('guardarPacienteConApoderado', () => {
    const datos = {
      nombre: ' Ana ',
      fecha_nacimiento: '2018-04-02',
      antecedentes: '',
      motivo_consulta: '',
      apoderado_nombre: 'Marta',
      apoderado_telefono: '+56912345678',
    };

    it('crea paciente y apoderado enlazados con propietaria', async () => {
      const p = await guardarPacienteConApoderado(repo, PROPIETARIA, datos);
      expect(p.nombre).toBe('Ana');
      const apoderado = p.apoderado_id === null ? null : await repo.obtenerApoderado(p.apoderado_id);
      expect(apoderado?.telefono).toBe('+56912345678');
      expect(apoderado?.propietaria_id).toBe(PROPIETARIA);
    });

    it('al editar reutiliza el apoderado existente en vez de duplicarlo', async () => {
      const p = await guardarPacienteConApoderado(repo, PROPIETARIA, datos);
      const editado = await guardarPacienteConApoderado(
        repo,
        PROPIETARIA,
        { ...datos, apoderado_telefono: null },
        p.id,
      );
      expect(editado.apoderado_id).toBe(p.apoderado_id);
      expect(await repo.listarApoderados()).toHaveLength(1);
      expect((await repo.listarApoderados())[0]?.telefono).toBeNull();
    });
  });
});

describe('filtrarPacientes', () => {
  const base = { propietaria_id: PROPIETARIA, apoderado_id: null, fecha_nacimiento: null, antecedentes: '', motivo_consulta: '', creado_en: '', modificado_en: '', estado_sync: 'pendiente' } as const;
  const lista = [
    { ...base, id: '1', nombre: 'José Núñez', archivado: false },
    { ...base, id: '2', nombre: 'Ana Soto', archivado: false },
    { ...base, id: '3', nombre: 'Josefa Archivada', archivado: true },
  ];

  it('busca sin distinguir mayúsculas ni tildes y excluye archivados', () => {
    expect(filtrarPacientes(lista, 'jose').map((p) => p.id)).toEqual(['1']);
    expect(filtrarPacientes(lista, 'NUNEZ').map((p) => p.id)).toEqual(['1']);
  });

  it('consulta vacía devuelve todos los activos; sin coincidencias devuelve vacío', () => {
    expect(filtrarPacientes(lista, '  ').map((p) => p.id)).toEqual(['1', '2']);
    expect(filtrarPacientes(lista, 'zzz')).toEqual([]);
  });
});

describe('combinarFechaHora', () => {
  it('convierte fecha y hora locales válidas a ISO', () => {
    expect(combinarFechaHora('2026-03-05', '09:05')).toBe(new Date(2026, 2, 5, 9, 5).toISOString());
  });

  it.each([
    ['2026-02-30', '10:00'],
    ['2026-03-05', '24:00'],
    ['2026-03-05', '10:60'],
    ['05/03/2026', '10:00'],
    ['2026-03-05', '9:00'],
  ])('rechaza %s %s', (fecha, hora) => {
    expect(combinarFechaHora(fecha, hora)).toBeNull();
  });
});
