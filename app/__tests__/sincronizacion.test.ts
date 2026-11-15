/**
 * Motor de sincronización: orden estricto, idempotencia, LWW, cortes de red,
 * reintentos con espera exponencial y limpieza de `evento_sync`.
 */
import { act, renderHook } from '@testing-library/react-native';

import { AlmacenSeguroMemoria, CLAVES_ALMACEN } from '../src/data/almacenSeguro';
import { ErrorRepositorio, IRepositorioClinico } from '../src/data/repositorio';
import type {
  InstantaneaServidor,
  OperacionColaSync,
  ResultadoOperacionSync,
} from '../src/data/tipos';
import { ErrorApi, TIEMPO_MAXIMO_SYNC_MS, crearClienteApi } from '../src/modules/acceso/api';
import { hayConexion, monitorRedNetInfo } from '../src/modules/sincronizacion/monitorRed';
import {
  ApiSync,
  ESPERA_MAXIMA_REINTENTO_MS,
  MAX_EVENTOS_SYNC,
  MonitorRed,
  MotorSync,
  Programador,
  esperaReintentoMs,
  mensajeSincronizacion,
} from '../src/modules/sincronizacion/motorSync';
import { crearMotorSync, useSincronizacion } from '../src/modules/sincronizacion/useSincronizacion';
import { INSTANTANEA_CON_PACIENTE, INSTANTANEA_VACIA } from './ayudas/acceso';
import {
  DependenciasPrueba,
  crearDependencias,
  crearRepositorioMemoria,
  crearRepositorioSQLitePrueba,
} from './ayudas/entorno';

type OyenteNetInfo = (estado: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void;
const mockOyentesNetInfo: OyenteNetInfo[] = [];
const mockCancelarNetInfo = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (oyente: OyenteNetInfo) => {
      mockOyentesNetInfo.push(oyente);
      return mockCancelarNetInfo;
    },
  },
}));

const PROPIETARIA = '7';
const TOKEN = 'token-de-prueba';
const TEXTO_CLINICO = 'CONTENIDO-CLINICO-SECRETO';

// ---------- Dobles de prueba ----------

class RedFalsa implements MonitorRed {
  private readonly oyentes = new Set<(conectado: boolean) => void>();

  suscribir(oyente: (conectado: boolean) => void): () => void {
    this.oyentes.add(oyente);
    return () => {
      this.oyentes.delete(oyente);
    };
  }

  emitir(conectado: boolean): void {
    this.oyentes.forEach((oyente) => oyente(conectado));
  }

  get suscripciones(): number {
    return this.oyentes.size;
  }
}

interface TareaProgramada {
  readonly tarea: () => void;
  readonly esperaMs: number;
  cancelada: boolean;
}

function crearProgramador() {
  const tareas: TareaProgramada[] = [];
  const programar: Programador = (tarea, esperaMs) => {
    const programada: TareaProgramada = { tarea, esperaMs, cancelada: false };
    tareas.push(programada);
    return () => {
      programada.cancelada = true;
    };
  };
  return { programar, tareas, vigentes: () => tareas.filter((t) => !t.cancelada) };
}

/** Servidor simulado: idempotente por `op_id`, con fallos y veredictos inyectables. */
class ServidorFalso implements ApiSync {
  readonly lotes: OperacionColaSync[][] = [];
  readonly tokens: string[] = [];
  /** Operaciones aplicadas de verdad (una sola vez por `op_id`). */
  readonly aplicadas: OperacionColaSync[] = [];
  /** Errores que lanzarán las próximas llamadas, sin procesar nada. */
  readonly fallos: ErrorApi[] = [];
  /** La próxima llamada procesa el lote pero su respuesta se pierde (corte de red). */
  perderRespuesta = false;
  /** Veredicto forzado para ciertas operaciones. */
  veredicto: (op: OperacionColaSync) => ResultadoOperacionSync | null = () => null;
  /** Se ejecuta al recibir cada lote, antes de responder. */
  alRecibir: () => void = () => undefined;
  instantanea: InstantaneaServidor = INSTANTANEA_VACIA;
  errorRestauracion: ErrorApi | null = null;
  private readonly recibidas = new Set<string>();

  async enviarOperaciones(token: string, operaciones: readonly OperacionColaSync[]) {
    this.tokens.push(token);
    this.lotes.push([...operaciones]);
    this.alRecibir();
    const fallo = this.fallos.shift();
    if (fallo) throw fallo;
    const resultados = operaciones.map((op): ResultadoOperacionSync => {
      if (this.recibidas.has(op.op_id)) {
        return { op_id: op.op_id, estado: 'duplicada', codigo_http: 200 };
      }
      const forzado = this.veredicto(op);
      if (forzado?.estado === 'rechazada') return forzado;
      this.recibidas.add(op.op_id);
      if (forzado) return forzado;
      this.aplicadas.push(op);
      return { op_id: op.op_id, estado: 'aplicada', codigo_http: 200 };
    });
    if (this.perderRespuesta) {
      this.perderRespuesta = false;
      throw new ErrorApi('red');
    }
    return resultados;
  }

  async descargarInstantanea(_token: string) {
    if (this.errorRestauracion) throw this.errorRestauracion;
    return this.instantanea;
  }

  get enviadas(): OperacionColaSync[] {
    return this.lotes.flat();
  }
}

interface Entorno {
  readonly repo: IRepositorioClinico;
  readonly servidor: ServidorFalso;
  readonly red: RedFalsa;
  readonly programador: ReturnType<typeof crearProgramador>;
  readonly sesion: { token: string | null };
  readonly motor: MotorSync;
}

function crearEntorno(opciones?: { tamanoLote?: number; repo?: IRepositorioClinico }): Entorno {
  const repo = opciones?.repo ?? crearRepositorioMemoria();
  const servidor = new ServidorFalso();
  const red = new RedFalsa();
  const programador = crearProgramador();
  const sesion: { token: string | null } = { token: TOKEN };
  const motor = new MotorSync({
    repositorio: repo,
    api: servidor,
    red,
    obtenerToken: async () => sesion.token,
    programar: programador.programar,
    tamanoLote: opciones?.tamanoLote,
  });
  return { repo, servidor, red, programador, sesion, motor };
}

/** Inicia el motor con red disponible y espera a que termine el primer ciclo. */
async function conectar({ motor, red }: Entorno): Promise<void> {
  motor.iniciar();
  red.emitir(true);
  await motor.enReposo();
}

async function crearCadena(repo: IRepositorioClinico) {
  const apoderado = await repo.crearApoderado({
    propietaria_id: PROPIETARIA,
    nombre: 'Apoderada Uno',
    telefono: '+56912345678',
  });
  const paciente = await repo.crearPaciente({
    propietaria_id: PROPIETARIA,
    apoderado_id: apoderado.id,
    nombre: 'Paciente Uno',
  });
  const cita = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: '2026-03-10T15:00:00.000Z' });
  const registro = await repo.crearRegistroSesion({ cita_id: cita.id, observaciones: TEXTO_CLINICO });
  return { apoderado, paciente, cita, registro };
}

function crearPaciente(repo: IRepositorioClinico, nombre = 'Paciente Uno') {
  return repo.crearPaciente({ propietaria_id: PROPIETARIA, nombre });
}

/** Dispara el reintento programado vigente y espera a que termine el ciclo. */
async function dispararReintento({ programador, motor }: Entorno): Promise<void> {
  const [vigente] = programador.vigentes();
  if (vigente === undefined) throw new Error('No hay ningún reintento programado.');
  vigente.cancelada = true;
  vigente.tarea();
  await motor.enReposo();
}

// ---------- Pruebas ----------

describe('orden de envío', () => {
  it('envía Apoderado -> Paciente -> Cita -> RegistroSesion aunque se hayan escrito en otro orden', async () => {
    const entorno = crearEntorno({ tamanoLote: 2 });
    const { repo, servidor } = entorno;
    const { apoderado, paciente, cita } = await crearCadena(repo);
    await repo.actualizarCita(cita.id, { estado: 'confirmada' });
    await repo.actualizarPaciente(paciente.id, { nombre: 'Paciente Editado' });
    await repo.actualizarApoderado(apoderado.id, { nombre: 'Apoderada Editada' });
    await repo.registrarAceptacionPolitica({ version: '1.0' });

    await conectar(entorno);

    expect(servidor.enviadas.map((op) => `${op.entidad}:${op.operacion}`)).toEqual([
      'aceptacion_politica:crear',
      'apoderado:crear',
      'apoderado:actualizar',
      'paciente:crear',
      'paciente:actualizar',
      'cita:crear',
      'cita:actualizar',
      'registro_sesion:crear',
    ]);
    // Lotes consecutivos del tamaño configurado, sin reordenar entre ellos.
    expect(servidor.lotes.map((lote) => lote.length)).toEqual([2, 2, 2, 2]);
    expect(servidor.tokens.every((token) => token === TOKEN)).toBe(true);
  });

  it('ante HTTP 200 vacía cola_sync y marca los registros como sincronizados', async () => {
    const entorno = crearEntorno();
    const { repo, motor } = entorno;
    const { apoderado, paciente, cita, registro } = await crearCadena(repo);

    await conectar(entorno);

    expect(await repo.listarColaSync()).toEqual([]);
    expect((await repo.obtenerApoderado(apoderado.id))?.estado_sync).toBe('sincronizado');
    expect((await repo.obtenerPaciente(paciente.id))?.estado_sync).toBe('sincronizado');
    expect((await repo.obtenerCita(cita.id))?.estado_sync).toBe('sincronizado');
    expect((await repo.obtenerRegistroSesion(registro.id))?.estado_sync).toBe('sincronizado');
    expect(motor.obtenerEstado()).toEqual({
      conectado: true,
      sincronizando: false,
      pendientes: 0,
      ultimoError: null,
      mensaje: 'Todo sincronizado',
    });
    expect(entorno.programador.vigentes()).toEqual([]);
  });

  it('si un lote falla no se envían los siguientes (no se adelanta ninguna entidad)', async () => {
    const entorno = crearEntorno({ tamanoLote: 1 });
    const { repo, servidor } = entorno;
    await crearCadena(repo);
    servidor.fallos.push(new ErrorApi('servidor', 503));

    await conectar(entorno);

    expect(servidor.lotes).toHaveLength(1);
    expect((await repo.listarColaSync()).map((op) => op.entidad)).toEqual([
      'apoderado',
      'paciente',
      'cita',
      'registro_sesion',
    ]);
  });

  it('un cambio local hecho con conexión se envía al notificarlo', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor } = entorno;
    await conectar(entorno);
    expect(servidor.lotes).toHaveLength(0);

    const paciente = await crearPaciente(repo);
    await motor.notificarCambioLocal();
    await motor.enReposo();

    expect(servidor.aplicadas.map((op) => op.registro_id)).toEqual([paciente.id]);
    expect(motor.obtenerEstado().pendientes).toBe(0);
  });
});

describe('idempotencia', () => {
  it('si se pierde la respuesta, reenvía los mismos op_id y el servidor no duplica', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor } = entorno;
    await crearCadena(repo);
    const opIds = (await repo.listarColaSync()).map((op) => op.op_id);
    servidor.perderRespuesta = true;

    await conectar(entorno);

    // El servidor aplicó todo, pero el teléfono no lo supo: la cola sigue intacta.
    expect(servidor.aplicadas).toHaveLength(4);
    expect((await repo.listarColaSync()).map((op) => op.op_id)).toEqual(opIds);
    expect(motor.obtenerEstado()).toMatchObject({ pendientes: 4, ultimoError: 'red' });

    await dispararReintento(entorno);

    expect(servidor.lotes).toHaveLength(2);
    expect(servidor.lotes[1]?.map((op) => op.op_id)).toEqual(opIds);
    expect(servidor.aplicadas).toHaveLength(4);
    expect(await repo.listarColaSync()).toEqual([]);
    expect(motor.obtenerEstado()).toMatchObject({ pendientes: 0, ultimoError: null });
  });

  it('dos llamadas simultáneas a sincronizar comparten el ciclo y no envían dos veces', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor } = entorno;
    await crearCadena(repo);
    motor.iniciar();
    entorno.red.emitir(true);

    await Promise.all([motor.sincronizar(), motor.sincronizar()]);
    await motor.enReposo();

    expect(servidor.enviadas).toHaveLength(4);
    expect(new Set(servidor.enviadas.map((op) => op.op_id)).size).toBe(4);
  });

  it('una operación ya confirmada no vuelve a enviarse en ciclos posteriores', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor } = entorno;
    await crearPaciente(repo);
    await conectar(entorno);

    await motor.sincronizar();
    await motor.sincronizar();

    expect(servidor.lotes).toHaveLength(1);
  });
});

describe('conflictos LWW y rechazos', () => {
  it('un conflicto (gana el servidor) retira la operación y deja un evento de metadatos', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor } = entorno;
    const paciente = await crearPaciente(repo, TEXTO_CLINICO);
    const [operacion] = await repo.listarColaSync();
    servidor.veredicto = (op) => ({ op_id: op.op_id, estado: 'conflicto', codigo_http: 200 });

    await conectar(entorno);

    expect(await repo.listarColaSync()).toEqual([]);
    expect((await repo.obtenerPaciente(paciente.id))?.estado_sync).toBe('sincronizado');
    expect(await repo.listarEventosSync()).toMatchObject([
      {
        tipo: 'conflicto',
        entidad: 'paciente',
        registro_id: paciente.id,
        op_id: operacion?.op_id,
        codigo_http: 200,
      },
    ]);
    expect(motor.obtenerEstado().ultimoError).toBeNull();
    expect(entorno.programador.vigentes()).toEqual([]);
  });

  it('una operación rechazada queda en la cola sin bloquear a las demás del lote', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor } = entorno;
    const aceptado = await crearPaciente(repo, 'Aceptado');
    const rechazado = await crearPaciente(repo, 'Rechazado');
    servidor.veredicto = (op) =>
      op.registro_id === rechazado.id
        ? { op_id: op.op_id, estado: 'rechazada', codigo_http: 404 }
        : null;

    await conectar(entorno);

    const cola = await repo.listarColaSync();
    expect(cola).toMatchObject([{ registro_id: rechazado.id, intentos: 1 }]);
    expect((await repo.obtenerPaciente(aceptado.id))?.estado_sync).toBe('sincronizado');
    expect((await repo.obtenerPaciente(rechazado.id))?.estado_sync).toBe('pendiente');
    expect(await repo.listarEventosSync()).toMatchObject([
      {
        tipo: 'envio_error',
        entidad: 'paciente',
        registro_id: rechazado.id,
        op_id: cola[0]?.op_id,
        codigo_http: 404,
      },
    ]);
    // No se reenvía dentro del mismo ciclo; se reintenta más tarde con espera.
    expect(servidor.lotes).toHaveLength(1);
    expect(motor.obtenerEstado()).toMatchObject({ pendientes: 1, ultimoError: 'rechazo' });
    expect(entorno.programador.vigentes().map((t) => t.esperaMs)).toEqual([5000]);

    servidor.veredicto = () => null;
    await dispararReintento(entorno);

    expect(await repo.listarColaSync()).toEqual([]);
    expect(motor.obtenerEstado()).toMatchObject({ pendientes: 0, ultimoError: null });
  });
});

describe('corte de red y reintentos', () => {
  it('sin conexión no envía nada y muestra «Sin conexión: N registros pendientes»', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor, red } = entorno;
    motor.iniciar();
    red.emitir(false);

    const paciente = await crearPaciente(repo);
    await motor.notificarCambioLocal();
    expect(motor.obtenerEstado().mensaje).toBe('Sin conexión: 1 registro pendiente');

    // Dos operaciones sobre el mismo registro cuentan como un solo registro pendiente.
    await repo.actualizarPaciente(paciente.id, { nombre: 'Editado' });
    await crearPaciente(repo, 'Paciente Dos');
    await crearPaciente(repo, 'Paciente Tres');
    await motor.notificarCambioLocal();

    expect(motor.obtenerEstado()).toMatchObject({
      conectado: false,
      pendientes: 3,
      mensaje: 'Sin conexión: 3 registros pendientes',
    });
    expect(servidor.lotes).toHaveLength(0);
    expect(entorno.programador.tareas).toEqual([]);
  });

  it('al recuperar la conexión envía la cola acumulada y actualiza el mensaje', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor, red } = entorno;
    motor.iniciar();
    red.emitir(false);
    await crearCadena(repo);
    await motor.notificarCambioLocal();
    const mensajes: string[] = [];
    motor.suscribir(() => mensajes.push(motor.obtenerEstado().mensaje));

    red.emitir(true);
    await motor.enReposo();

    expect(servidor.aplicadas).toHaveLength(4);
    expect(mensajes[0]).toBe('Por sincronizar: 4 registros pendientes');
    expect(mensajes).toContain('Sincronizando: 4 registros pendientes');
    expect(mensajes.at(-1)).toBe('Todo sincronizado');
  });

  it('un corte a mitad de envío conserva lo confirmado y deja el resto pendiente en orden', async () => {
    const entorno = crearEntorno({ tamanoLote: 1 });
    const { repo, servidor, motor } = entorno;
    const { apoderado, paciente } = await crearCadena(repo);
    servidor.alRecibir = () => {
      if (servidor.lotes.length === 2) servidor.fallos.push(new ErrorApi('red'));
    };

    await conectar(entorno);

    expect(servidor.lotes).toHaveLength(2);
    expect((await repo.obtenerApoderado(apoderado.id))?.estado_sync).toBe('sincronizado');
    expect((await repo.obtenerPaciente(paciente.id))?.estado_sync).toBe('pendiente');
    expect(await repo.listarColaSync()).toMatchObject([
      { entidad: 'paciente', intentos: 1 },
      { entidad: 'cita', intentos: 0 },
      { entidad: 'registro_sesion', intentos: 0 },
    ]);
    expect(await repo.listarEventosSync()).toMatchObject([
      { tipo: 'envio_error', entidad: null, registro_id: null, op_id: null, codigo_http: null },
    ]);
    expect(motor.obtenerEstado()).toMatchObject({
      sincronizando: false,
      pendientes: 3,
      ultimoError: 'red',
    });
  });

  it('si la red se cae entre lotes no intenta el siguiente', async () => {
    const entorno = crearEntorno({ tamanoLote: 1 });
    const { repo, servidor, motor, red } = entorno;
    await crearCadena(repo);
    servidor.alRecibir = () => red.emitir(false);

    await conectar(entorno);

    expect(servidor.lotes).toHaveLength(1);
    expect(motor.obtenerEstado()).toMatchObject({
      conectado: false,
      ultimoError: 'red',
      mensaje: 'Sin conexión: 3 registros pendientes',
    });
    // Sin red no se programa ningún reintento: se espera al aviso de reconexión.
    expect(entorno.programador.vigentes()).toEqual([]);
  });

  it('reintenta con espera exponencial y la reinicia tras un envío exitoso', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, programador } = entorno;
    await crearPaciente(repo);
    servidor.fallos.push(
      new ErrorApi('red'),
      new ErrorApi('servidor', 502),
      new ErrorApi('limite', 429),
    );

    await conectar(entorno);
    await dispararReintento(entorno);
    await dispararReintento(entorno);
    expect(programador.tareas.map((t) => t.esperaMs)).toEqual([5000, 10000, 20000]);
    expect((await repo.listarColaSync())[0]?.intentos).toBe(3);
    expect((await repo.listarEventosSync()).map((e) => e.codigo_http)).toEqual([null, 502, 429]);

    await dispararReintento(entorno);
    expect(await repo.listarColaSync()).toEqual([]);
    expect(programador.vigentes()).toEqual([]);

    // Tras el éxito, un fallo nuevo vuelve a empezar desde la espera base.
    await crearPaciente(repo, 'Paciente Dos');
    servidor.fallos.push(new ErrorApi('red'));
    await entorno.motor.notificarCambioLocal();
    await entorno.motor.enReposo();
    expect(programador.vigentes().map((t) => t.esperaMs)).toEqual([5000]);
  });

  it('la espera crece 5 s, 10 s, 20 s... con tope de 5 minutos', () => {
    expect([1, 2, 3, 4].map(esperaReintentoMs)).toEqual([5000, 10000, 20000, 40000]);
    expect(esperaReintentoMs(0)).toBe(5000);
    expect(esperaReintentoMs(7)).toBe(ESPERA_MAXIMA_REINTENTO_MS);
    expect(esperaReintentoMs(1000)).toBe(ESPERA_MAXIMA_REINTENTO_MS);
  });

  it('perder la red cancela el reintento programado; recuperarla reintenta de inmediato', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, red, motor, programador } = entorno;
    await crearPaciente(repo);
    servidor.fallos.push(new ErrorApi('red'), new ErrorApi('red'));
    await conectar(entorno);
    await dispararReintento(entorno);
    expect(programador.vigentes().map((t) => t.esperaMs)).toEqual([10000]);

    red.emitir(false);
    expect(programador.vigentes()).toEqual([]);

    red.emitir(true);
    await motor.enReposo();
    expect(await repo.listarColaSync()).toEqual([]);
    expect(servidor.lotes).toHaveLength(3);
  });

  it('un token rechazado (401) no se reintenta solo', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor } = entorno;
    await crearPaciente(repo);
    servidor.fallos.push(new ErrorApi('no_autorizado', 401));

    await conectar(entorno);

    expect(motor.obtenerEstado()).toMatchObject({ pendientes: 1, ultimoError: 'no_autorizado' });
    expect(entorno.programador.tareas).toEqual([]);
    expect(await repo.listarEventosSync()).toMatchObject([{ tipo: 'envio_error', codigo_http: 401 }]);
  });

  it('sin sesión no envía nada y conserva la cola', async () => {
    const entorno = crearEntorno();
    entorno.sesion.token = null;
    await crearPaciente(entorno.repo);

    await conectar(entorno);

    expect(entorno.servidor.lotes).toHaveLength(0);
    expect(entorno.motor.obtenerEstado()).toMatchObject({ pendientes: 1, ultimoError: null });
  });

  it('un fallo del almacenamiento local no rompe el motor y se reintenta', async () => {
    const entorno = crearEntorno();
    const { repo, motor } = entorno;
    await crearPaciente(repo);
    const original = repo.confirmarOperacionSync.bind(repo);
    repo.confirmarOperacionSync = jest
      .fn(original)
      .mockRejectedValueOnce(new ErrorRepositorio('no_inicializado', 'fallo simulado'));

    await conectar(entorno);
    expect(motor.obtenerEstado()).toMatchObject({ pendientes: 1, ultimoError: 'interno' });

    await dispararReintento(entorno);
    expect(motor.obtenerEstado()).toMatchObject({ pendientes: 0, ultimoError: null });
  });

  it('detener cancela la escucha de red y los reintentos pendientes', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, red, motor, programador } = entorno;
    await crearPaciente(repo);
    servidor.fallos.push(new ErrorApi('red'));
    await conectar(entorno);
    expect(programador.vigentes()).toHaveLength(1);

    motor.detener();

    expect(programador.vigentes()).toEqual([]);
    expect(red.suscripciones).toBe(0);
    // Se puede volver a iniciar (p. ej. al desbloquear la app de nuevo).
    motor.iniciar();
    expect(red.suscripciones).toBe(1);
  });
});

describe('cliente HTTP de sincronización', () => {
  function respuesta(status: number, cuerpo?: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => cuerpo,
    } as Response;
  }

  async function operacionDePrueba(): Promise<OperacionColaSync> {
    const repo = crearRepositorioMemoria();
    await crearPaciente(repo);
    const [operacion] = await repo.listarColaSync();
    if (operacion === undefined) throw new Error('cola vacía');
    return operacion;
  }

  it('envía el lote por POST con el token en la cabecera y sin el contador local', async () => {
    const operacion = await operacionDePrueba();
    const resultados = [{ op_id: operacion.op_id, estado: 'aplicada', codigo_http: 200, codigo: null }];
    const fetchFalso = jest.fn(async (_url: string, _init: RequestInit) => respuesta(200, { resultados }));
    const api = crearClienteApi({ urlBase: 'https://api.ejemplo.cl', fetch: fetchFalso });

    expect(await api.enviarOperaciones(TOKEN, [operacion])).toEqual([
      { op_id: operacion.op_id, estado: 'aplicada', codigo_http: 200 },
    ]);

    const [url, init] = fetchFalso.mock.calls[0] ?? [];
    expect(url).toBe('https://api.ejemplo.cl/api/clinica/sincronizar/');
    expect(url).not.toContain(TOKEN);
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: `Token ${TOKEN}` } });
    const { intentos: _intentos, ...sinIntentos } = operacion;
    expect(JSON.parse(String(init?.body))).toEqual({ operaciones: [sinIntentos] });
  });

  it.each([
    ['sin lista de resultados', { otra: 1 }],
    ['con menos resultados que operaciones', { resultados: [] }],
    ['con un op_id que no corresponde', { resultados: [{ op_id: 'otro', estado: 'aplicada' }] }],
    ['con un estado desconocido', { resultados: [{ op_id: 'OP', estado: 'inventado' }] }],
  ])('rechaza una respuesta %s', async (_caso, cuerpo) => {
    const operacion = await operacionDePrueba();
    const texto = JSON.stringify(cuerpo).replace('"OP"', JSON.stringify(operacion.op_id));
    const api = crearClienteApi({
      urlBase: 'https://api.ejemplo.cl',
      fetch: async () => respuesta(200, JSON.parse(texto)),
    });
    await expect(api.enviarOperaciones(TOKEN, [operacion])).rejects.toMatchObject({ tipo: 'servidor' });
  });

  it.each([
    [401, 'no_autorizado'],
    [429, 'limite'],
    [503, 'servidor'],
  ])('HTTP %i se informa como "%s" sin exponer el cuerpo', async (status, tipo) => {
    const api = crearClienteApi({
      urlBase: 'https://api.ejemplo.cl',
      fetch: async () => respuesta(status, { detail: TEXTO_CLINICO }),
    });
    const error = await api.enviarOperaciones(TOKEN, []).catch((e: unknown) => e);
    expect(error).toMatchObject({ tipo, codigoHttp: status });
    expect((error as Error).message).not.toContain(TEXTO_CLINICO);
  });

  it('espera hasta 120 s (arranque en frío del servidor) antes de abortar', async () => {
    expect(TIEMPO_MAXIMO_SYNC_MS).toBe(120_000);
    jest.useFakeTimers();
    try {
      const fetchColgado = (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolver, rechazar) => {
          init.signal?.addEventListener('abort', () => rechazar(new Error('abortado')));
        });
      const api = crearClienteApi({ urlBase: 'https://api.ejemplo.cl', fetch: fetchColgado });
      let desenlace: unknown = 'en curso';
      void api.enviarOperaciones(TOKEN, []).then(
        () => (desenlace = 'respondió'),
        (error: unknown) => (desenlace = error),
      );

      await jest.advanceTimersByTimeAsync(TIEMPO_MAXIMO_SYNC_MS - 1);
      expect(desenlace).toBe('en curso');

      await jest.advanceTimersByTimeAsync(1);
      expect(desenlace).toBeInstanceOf(ErrorApi);
      expect(desenlace).toMatchObject({ tipo: 'red' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('evento_sync', () => {
  it('nunca contiene datos clínicos, ni tampoco el estado público del motor', async () => {
    const entorno = crearEntorno({ tamanoLote: 2 });
    const { repo, servidor, motor } = entorno;
    const { paciente, cita } = await crearCadena(repo);
    await repo.actualizarPaciente(paciente.id, { antecedentes: TEXTO_CLINICO, motivo_consulta: TEXTO_CLINICO });
    servidor.veredicto = (op) => {
      if (op.entidad === 'cita') return { op_id: op.op_id, estado: 'rechazada', codigo_http: 400 };
      if (op.operacion === 'actualizar') return { op_id: op.op_id, estado: 'conflicto', codigo_http: 200 };
      return null;
    };
    servidor.fallos.push(new ErrorApi('servidor', 500));

    await conectar(entorno);
    await dispararReintento(entorno);

    const eventos = await repo.listarEventosSync();
    // Fallo del primer lote (500), conflicto del paciente y rechazo de la cita (400).
    expect(eventos.map((e) => `${e.tipo}:${e.codigo_http}`)).toEqual([
      'envio_error:500',
      'conflicto:200',
      'envio_error:400',
    ]);
    expect(eventos.find((e) => e.entidad === 'cita')).toMatchObject({ registro_id: cita.id, codigo_http: 400 });
    for (const evento of eventos) {
      expect(Object.keys(evento).sort()).toEqual(
        ['codigo_http', 'entidad', 'evento_id', 'ocurrido_en', 'op_id', 'registro_id', 'tipo'].sort(),
      );
    }
    expect(JSON.stringify(eventos)).not.toContain(TEXTO_CLINICO);
    expect(JSON.stringify(eventos)).not.toContain('Paciente Uno');
    expect(JSON.stringify(motor.obtenerEstado())).not.toContain(TEXTO_CLINICO);
  });

  it('cada ciclo limpia el diario y conserva solo los eventos más recientes', async () => {
    const entorno = crearEntorno();
    const { repo, servidor } = entorno;
    for (let i = 0; i < MAX_EVENTOS_SYNC + 5; i += 1) {
      await repo.registrarEventoSync({
        tipo: 'envio_ok',
        entidad: null,
        registro_id: null,
        op_id: null,
        codigo_http: i,
      });
    }
    await crearPaciente(repo);
    servidor.fallos.push(new ErrorApi('servidor', 599));

    await conectar(entorno);

    const eventos = await repo.listarEventosSync();
    expect(eventos).toHaveLength(MAX_EVENTOS_SYNC);
    // Se eliminaron los 6 más antiguos y el evento del fallo recién ocurrido se conserva.
    expect(eventos[0]?.codigo_http).toBe(6);
    expect(eventos.at(-1)).toMatchObject({ tipo: 'envio_error', codigo_http: 599 });
  });

  it('un fallo en la limpieza no impide sincronizar', async () => {
    const entorno = crearEntorno();
    const { repo, motor } = entorno;
    await crearPaciente(repo);
    repo.limpiarEventosSync = jest.fn().mockRejectedValue(new Error('fallo simulado'));

    await conectar(entorno);

    expect(await repo.listarColaSync()).toEqual([]);
    expect(motor.obtenerEstado().ultimoError).toBeNull();
  });

  const implementaciones: [string, (deps: DependenciasPrueba) => IRepositorioClinico][] = [
    ['RepositorioMemoria', (deps) => crearRepositorioMemoria(deps)],
    ['RepositorioSQLite', (deps) => crearRepositorioSQLitePrueba(deps).repositorio],
  ];

  describe.each(implementaciones)('limpiarEventosSync en %s', (_nombre, crear) => {
    let repo: IRepositorioClinico;

    beforeEach(async () => {
      repo = crear(crearDependencias());
      await repo.inicializar();
      for (let i = 1; i <= 5; i += 1) {
        await repo.registrarEventoSync({
          tipo: 'envio_error',
          entidad: null,
          registro_id: null,
          op_id: null,
          codigo_http: i,
        });
      }
    });

    afterEach(async () => {
      await repo.cerrar();
    });

    it('conserva los más recientes y devuelve cuántos eliminó', async () => {
      expect(await repo.limpiarEventosSync(10)).toBe(0);
      expect(await repo.limpiarEventosSync(2)).toBe(3);
      expect((await repo.listarEventosSync()).map((e) => e.codigo_http)).toEqual([4, 5]);
      expect(await repo.limpiarEventosSync(0)).toBe(2);
      expect(await repo.listarEventosSync()).toEqual([]);
    });

    it('rechaza un límite inválido sin borrar nada', async () => {
      await expect(repo.limpiarEventosSync(-1)).rejects.toMatchObject({ codigo: 'validacion' });
      await expect(repo.limpiarEventosSync(1.5)).rejects.toMatchObject({ codigo: 'validacion' });
      expect(await repo.listarEventosSync()).toHaveLength(5);
    });

    it('no toca los datos clínicos ni la cola', async () => {
      const paciente = await crearPaciente(repo);
      await repo.limpiarEventosSync(0);
      expect(await repo.obtenerPaciente(paciente.id)).not.toBeNull();
      expect(await repo.listarColaSync()).toHaveLength(1);
    });
  });
});

describe('restaurarDesdeServidor', () => {
  it('carga la copia del servidor como sincronizada y registra el evento', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor } = entorno;
    servidor.instantanea = INSTANTANEA_CON_PACIENTE;

    await motor.restaurarDesdeServidor();

    const pacientes = await repo.listarPacientes();
    expect(pacientes).toMatchObject([{ nombre: 'Paciente del servidor', estado_sync: 'sincronizado' }]);
    expect(await repo.listarColaSync()).toEqual([]);
    expect(await repo.listarEventosSync()).toMatchObject([{ tipo: 'restauracion', codigo_http: 200 }]);
    expect(motor.obtenerEstado().pendientes).toBe(0);
  });

  it('falla sin sesión, sin red o si ya hay datos locales, sin alterar el repositorio', async () => {
    const entorno = crearEntorno();
    const { repo, servidor, motor, sesion } = entorno;

    sesion.token = null;
    await expect(motor.restaurarDesdeServidor()).rejects.toMatchObject({ tipo: 'no_autorizado' });

    sesion.token = TOKEN;
    servidor.errorRestauracion = new ErrorApi('red');
    await expect(motor.restaurarDesdeServidor()).rejects.toMatchObject({ tipo: 'red' });
    expect(await repo.estaVacio()).toBe(true);

    servidor.errorRestauracion = null;
    servidor.instantanea = INSTANTANEA_CON_PACIENTE;
    await crearPaciente(repo, 'Local');
    await expect(motor.restaurarDesdeServidor()).rejects.toMatchObject({ codigo: 'no_vacio' });
    expect((await repo.listarPacientes()).map((p) => p.nombre)).toEqual(['Local']);
  });
});

describe('estado de red y hook de React', () => {
  it('mensajeSincronizacion cubre todos los estados', () => {
    const base = { conectado: false, sincronizando: false, pendientes: 0 };
    expect(mensajeSincronizacion(base)).toBe('Sin conexión');
    expect(mensajeSincronizacion({ ...base, pendientes: 1 })).toBe('Sin conexión: 1 registro pendiente');
    expect(mensajeSincronizacion({ ...base, pendientes: 12 })).toBe('Sin conexión: 12 registros pendientes');
    expect(mensajeSincronizacion({ ...base, conectado: true })).toBe('Todo sincronizado');
    expect(mensajeSincronizacion({ conectado: true, sincronizando: true, pendientes: 2 })).toBe(
      'Sincronizando: 2 registros pendientes',
    );
    expect(mensajeSincronizacion({ conectado: true, sincronizando: false, pendientes: 2 })).toBe(
      'Por sincronizar: 2 registros pendientes',
    );
  });

  it('NetInfo: hay conexión solo con red y sin internet declarado inalcanzable', () => {
    expect(hayConexion({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(hayConexion({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(hayConexion({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(hayConexion({ isConnected: false, isInternetReachable: false })).toBe(false);
    expect(hayConexion({ isConnected: null, isInternetReachable: null })).toBe(false);
  });

  it('el monitor de NetInfo traduce los cambios y cancela la suscripción', () => {
    mockCancelarNetInfo.mockClear();
    const recibidos: boolean[] = [];
    const cancelar = monitorRedNetInfo.suscribir((conectado) => recibidos.push(conectado));
    const oyente = mockOyentesNetInfo.at(-1);

    oyente?.({ isConnected: true, isInternetReachable: true });
    oyente?.({ isConnected: false, isInternetReachable: false });
    cancelar();

    expect(recibidos).toEqual([true, false]);
    expect(mockCancelarNetInfo).toHaveBeenCalledTimes(1);
  });

  it('crearMotorSync escucha NetInfo y usa el token del almacén seguro', async () => {
    const repo = crearRepositorioMemoria();
    const servidor = new ServidorFalso();
    const almacenSeguro = new AlmacenSeguroMemoria();
    await almacenSeguro.guardar(CLAVES_ALMACEN.token, TOKEN);
    await crearPaciente(repo);
    const motor = crearMotorSync({ repositorio: repo, api: servidor, almacenSeguro });

    motor.iniciar();
    mockOyentesNetInfo.at(-1)?.({ isConnected: true, isInternetReachable: true });
    await motor.enReposo();
    motor.detener();

    expect(servidor.tokens).toEqual([TOKEN]);
    expect(await repo.listarColaSync()).toEqual([]);
  });

  it('useSincronizacion expone el estado del motor y lo detiene al desmontar', async () => {
    const entorno = crearEntorno();
    const { repo, red, motor, servidor } = entorno;
    await crearPaciente(repo);

    const { result, unmount } = await renderHook(() => useSincronizacion(motor));
    await act(async () => {
      red.emitir(false);
      await result.current.notificarCambioLocal();
    });
    expect(red.suscripciones).toBe(1);
    expect(result.current).toMatchObject({
      conectado: false,
      pendientes: 1,
      mensaje: 'Sin conexión: 1 registro pendiente',
    });

    await act(async () => {
      red.emitir(true);
      await motor.enReposo();
    });
    expect(servidor.aplicadas).toHaveLength(1);
    expect(result.current).toMatchObject({ conectado: true, pendientes: 0, mensaje: 'Todo sincronizado' });

    await act(async () => {
      await result.current.sincronizarAhora();
    });
    expect(servidor.lotes).toHaveLength(1);

    await unmount();
    expect(red.suscripciones).toBe(0);
  });
});
