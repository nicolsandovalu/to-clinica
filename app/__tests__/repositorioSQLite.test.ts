/** Aspectos propios de la implementación SQLite: cifrado, esquema y restricciones a nivel de SQL. */
import { AlmacenSeguroMemoria, CLAVES_ALMACEN } from '../src/data/almacenSeguro';
import { RepositorioSQLite } from '../src/data/repositorioSQLite';
import { crearBaseDatosPrueba, crearDependencias, crearRepositorioSQLitePrueba } from './ayudas/entorno';

describe('RepositorioSQLite: cifrado', () => {
  it('genera una clave de 256 bits, la guarda en el almacén seguro y la aplica con PRAGMA key', async () => {
    const { repositorio, baseDatos, almacenSeguro } = crearRepositorioSQLitePrueba();
    expect(await almacenSeguro.obtener(CLAVES_ALMACEN.claveBaseDatos)).toBeNull();

    await repositorio.inicializar();

    const clave = await almacenSeguro.obtener(CLAVES_ALMACEN.claveBaseDatos);
    expect(clave).toMatch(/^[0-9a-f]{64}$/);
    // Primera sentencia de la conexión, antes de cualquier lectura o escritura.
    expect(baseDatos.sentenciasExec[0]).toBe(`PRAGMA key = "x'${clave}'";`);
  });

  it('reutiliza la clave existente en los inicios siguientes', async () => {
    const almacenSeguro = new AlmacenSeguroMemoria();
    const generarBytesAleatorios = jest.fn(async (n: number) => crypto.getRandomValues(new Uint8Array(n)));
    const abrir = async () => {
      const baseDatos = crearBaseDatosPrueba();
      const repositorio = new RepositorioSQLite({
        ...crearDependencias(),
        almacenSeguro,
        generarBytesAleatorios,
        abrirBaseDatos: async () => baseDatos,
      });
      await repositorio.inicializar();
      return baseDatos.sentenciasExec[0];
    };

    const primera = await abrir();
    const segunda = await abrir();

    expect(segunda).toBe(primera);
    expect(generarBytesAleatorios).toHaveBeenCalledTimes(1);
    expect(generarBytesAleatorios).toHaveBeenCalledWith(32);
  });

  it('claves de instalaciones distintas son distintas', async () => {
    const a = crearRepositorioSQLitePrueba();
    const b = crearRepositorioSQLitePrueba();
    await a.repositorio.inicializar();
    await b.repositorio.inicializar();
    expect(await a.almacenSeguro.obtener(CLAVES_ALMACEN.claveBaseDatos)).not.toBe(
      await b.almacenSeguro.obtener(CLAVES_ALMACEN.claveBaseDatos),
    );
  });

  it('falla cerrada si el binario no trae SQLCipher: no crea tablas ni guarda datos', async () => {
    const baseDatos = crearBaseDatosPrueba({ conCifrado: false });
    const cerrar = jest.spyOn(baseDatos, 'closeAsync');
    const repositorio = new RepositorioSQLite({
      ...crearDependencias(),
      almacenSeguro: new AlmacenSeguroMemoria(),
      generarBytesAleatorios: async (n) => crypto.getRandomValues(new Uint8Array(n)),
      abrirBaseDatos: async () => baseDatos,
    });

    await expect(repositorio.inicializar()).rejects.toMatchObject({ codigo: 'cifrado_no_disponible' });
    expect(baseDatos.sentenciasExec.some((sql) => /CREATE TABLE/i.test(sql))).toBe(false);
    expect(cerrar).toHaveBeenCalled();
    await expect(
      repositorio.crearPaciente({ propietaria_id: '1', nombre: 'Ana' }),
    ).rejects.toMatchObject({ codigo: 'no_inicializado' });
  });

  it('rechaza una clave guardada con formato inválido en vez de inyectarla en el PRAGMA', async () => {
    const almacenSeguro = new AlmacenSeguroMemoria();
    await almacenSeguro.guardar(CLAVES_ALMACEN.claveBaseDatos, `00'; DROP TABLE paciente; --`);
    const baseDatos = crearBaseDatosPrueba();
    const repositorio = new RepositorioSQLite({
      ...crearDependencias(),
      almacenSeguro,
      generarBytesAleatorios: async (n) => new Uint8Array(n),
      abrirBaseDatos: async () => baseDatos,
    });
    await expect(repositorio.inicializar()).rejects.toMatchObject({ codigo: 'cifrado_no_disponible' });
    expect(baseDatos.sentenciasExec).toEqual([]);
  });
});

describe('RepositorioSQLite: esquema', () => {
  async function preparar() {
    const entorno = crearRepositorioSQLitePrueba();
    await entorno.repositorio.inicializar();
    const paciente = await entorno.repositorio.crearPaciente({ propietaria_id: '1', nombre: 'Ana' });
    const cita = await entorno.repositorio.crearCita({
      paciente_id: paciente.id,
      fecha_hora: '2026-03-10T15:00:00Z',
    });
    const registro = await entorno.repositorio.crearRegistroSesion({ cita_id: cita.id });
    return { ...entorno, motor: entorno.baseDatos.motor, paciente, cita, registro };
  }

  it('crea los índices equivalentes a los de PostgreSQL', async () => {
    const { motor } = await preparar();
    const columnas = (indice: string) =>
      motor.prepare(`PRAGMA index_info(${indice})`).all().map((fila) => fila.name);

    expect(columnas('paciente_propietaria_nombre')).toEqual(['propietaria_id', 'nombre']);
    expect(columnas('cita_fecha_hora')).toEqual(['fecha_hora']);
    expect(columnas('cita_paciente_fecha_hora')).toEqual(['paciente_id', 'fecha_hora']);

    const unicos = motor.prepare(`PRAGMA index_list(registro_sesion)`).all().filter((i) => i.unique === 1);
    const columnasUnicas = unicos.flatMap((i) => columnas(String(i.name)));
    expect(columnasUnicas).toContain('cita_id');
  });

  it('las tablas locales tienen estado_sync restringido a pendiente | sincronizado', async () => {
    const { motor, paciente } = await preparar();
    for (const tabla of ['aceptacion_politica', 'apoderado', 'paciente', 'cita', 'registro_sesion']) {
      const columnas = motor.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
      expect(columnas).toContain('estado_sync');
    }
    expect(() =>
      motor.prepare(`UPDATE paciente SET estado_sync = 'otro' WHERE id = ?`).run(paciente.id),
    ).toThrow(/CHECK/);
  });

  it('las restricciones CHECK, UNIQUE y de clave foránea rigen también para SQL directo', async () => {
    const { motor, paciente, cita } = await preparar();
    const ahora = '2026-03-10T15:00:00.000Z';

    expect(() => motor.prepare(`UPDATE cita SET estado = 'eliminada' WHERE id = ?`).run(cita.id)).toThrow(
      /CHECK/,
    );
    expect(() => motor.prepare(`UPDATE paciente SET nombre = '  ' WHERE id = ?`).run(paciente.id)).toThrow(
      /CHECK/,
    );
    expect(() => motor.prepare(`UPDATE paciente SET archivado = 2 WHERE id = ?`).run(paciente.id)).toThrow(
      /CHECK/,
    );
    expect(() =>
      motor
        .prepare(`INSERT INTO apoderado (id, propietaria_id, nombre, telefono) VALUES ('a', '1', 'Apo', ?)`)
        .run('+56 9 1234 5678'),
    ).toThrow(/CHECK/);
    expect(() =>
      motor
        .prepare(`INSERT INTO registro_sesion (id, cita_id, creado_en, modificado_en) VALUES ('r2', ?, ?, ?)`)
        .run(cita.id, ahora, ahora),
    ).toThrow(/UNIQUE/);
    expect(() =>
      motor
        .prepare(`INSERT INTO cita (id, paciente_id, fecha_hora, creado_en, modificado_en) VALUES ('c2', 'no-existe', ?, ?, ?)`)
        .run(ahora, ahora, ahora),
    ).toThrow(/FOREIGN KEY/);
    expect(() => motor.prepare(`INSERT INTO cola_sync (op_id, documento) VALUES ('x', 'no es json')`).run()).toThrow(
      /CHECK/,
    );
  });

  it.each(['aceptacion_politica', 'apoderado', 'paciente', 'cita', 'registro_sesion'])(
    'impide el DELETE físico en %s',
    async (tabla) => {
      const { motor, repositorio } = await preparar();
      await repositorio.crearApoderado({ propietaria_id: '1', nombre: 'Apo' });
      await repositorio.registrarAceptacionPolitica({ version: '1.0' });
      const antes = motor.prepare(`SELECT count(*) AS total FROM ${tabla}`).get()?.total;

      expect(() => motor.exec(`DELETE FROM ${tabla}`)).toThrow(/eliminacion fisica prohibida/);
      expect(motor.prepare(`SELECT count(*) AS total FROM ${tabla}`).get()?.total).toBe(antes);
      expect(antes).toBeGreaterThan(0);
    },
  );

  it('guarda cola_sync como documento JSON con los campos del contrato', async () => {
    const { motor, paciente } = await preparar();
    const fila = motor
      .prepare(`SELECT op_id, documento FROM cola_sync WHERE json_extract(documento, '$.entidad') = 'paciente'`)
      .get();
    const documento = JSON.parse(String(fila?.documento)) as Record<string, unknown>;

    expect(Object.keys(documento).sort()).toEqual(
      ['datos', 'entidad', 'intentos', 'modificado_en', 'operacion', 'registro_id'].sort(),
    );
    expect(documento.registro_id).toBe(paciente.id);
  });
});
