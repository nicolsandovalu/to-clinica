/**
 * Cliente HTTP del backend (acceso, sincronización y restauración).
 * Autenticación solo por cabecera `Authorization: Token ...` (AUT-06).
 * Ningún error incluye el cuerpo de la respuesta ni datos de la usuaria.
 */
import {
  ESTADOS_RESULTADO_SYNC,
  InstantaneaServidor,
  OperacionColaSync,
  ResultadoOperacionSync,
} from '../../data/tipos';

export const MENSAJE_LOGIN_GENERICO = 'Correo o contraseña incorrectos.';

/** Sincronización y restauración toleran el arranque en frío del servidor (Render). */
export const TIEMPO_MAXIMO_SYNC_MS = 120_000;

/** El inicio de sesión también espera el arranque en frío del servidor (~50 s en Render gratis). */
export const TIEMPO_MAXIMO_LOGIN_MS = 60_000;

export type TipoErrorApi = 'credenciales' | 'limite' | 'no_autorizado' | 'red' | 'servidor';

export class ErrorApi extends Error {
  readonly tipo: TipoErrorApi;
  readonly codigoHttp: number | null;

  constructor(tipo: TipoErrorApi, codigoHttp: number | null = null) {
    super(`Error de API: ${tipo}`);
    this.name = 'ErrorApi';
    this.tipo = tipo;
    this.codigoHttp = codigoHttp;
  }
}

export interface Sesion {
  readonly usuaria_id: string;
  readonly email: string;
}

export interface RespuestaLogin {
  readonly token: string;
  readonly sesion: Sesion;
}

export interface ClienteApi {
  /** `POST /api/cuentas/login/` con `{ email, password }` -> `{ token, usuaria: { id, email } }`. */
  login(email: string, password: string): Promise<RespuestaLogin>;
  /** `POST /api/cuentas/logout/`: revoca el token en el servidor. */
  logout(token: string): Promise<void>;
  /** `GET /api/clinica/restaurar/`: copia completa de los datos de la usuaria. */
  descargarInstantanea(token: string): Promise<InstantaneaServidor>;
  /**
   * `POST /api/clinica/sincronizar/`: envía un lote del outbox y devuelve un
   * resultado por operación, en el mismo orden.
   */
  enviarOperaciones(
    token: string,
    operaciones: readonly OperacionColaSync[],
  ): Promise<ResultadoOperacionSync[]>;
}

type Fetch = (url: string, opciones: RequestInit) => Promise<Response>;

export interface OpcionesClienteApi {
  readonly urlBase: string;
  readonly fetch?: Fetch;
  readonly tiempoMaximoMs?: number;
  /** Solo para desarrollo local; en producción la URL debe ser HTTPS. */
  readonly permitirHttp?: boolean;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

export function crearClienteApi(opciones: OpcionesClienteApi): ClienteApi {
  const urlBase = opciones.urlBase.replace(/\/+$/, '');
  const esHttps = urlBase.startsWith('https://');
  if (!esHttps && !(opciones.permitirHttp === true && urlBase.startsWith('http://'))) {
    throw new Error('La URL del servidor debe usar HTTPS.');
  }
  const hacerFetch: Fetch = opciones.fetch ?? ((url, init) => fetch(url, init));
  const tiempoMaximoMs = opciones.tiempoMaximoMs ?? 15000;

  async function pedir(
    metodo: 'GET' | 'POST',
    ruta: string,
    extras: { token?: string; cuerpo?: unknown; tiempoMaximoMs?: number },
  ): Promise<Response> {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), extras.tiempoMaximoMs ?? tiempoMaximoMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (extras.token !== undefined) headers.Authorization = `Token ${extras.token}`;
    if (extras.cuerpo !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await hacerFetch(`${urlBase}${ruta}`, {
        method: metodo,
        headers,
        body: extras.cuerpo === undefined ? undefined : JSON.stringify(extras.cuerpo),
        signal: control.signal,
      });
    } catch {
      throw new ErrorApi('red');
    } finally {
      clearTimeout(temporizador);
    }
  }

  async function leerJson(respuesta: Response): Promise<unknown> {
    try {
      return await respuesta.json();
    } catch {
      throw new ErrorApi('servidor', respuesta.status);
    }
  }

  function errorGenerico(respuesta: Response): ErrorApi {
    if (respuesta.status === 401 || respuesta.status === 403) {
      return new ErrorApi('no_autorizado', respuesta.status);
    }
    if (respuesta.status === 429) return new ErrorApi('limite', 429);
    return new ErrorApi('servidor', respuesta.status);
  }

  return {
    async login(email, password) {
      const respuesta = await pedir('POST', '/api/cuentas/login/', {
        cuerpo: { email, password },
        tiempoMaximoMs: TIEMPO_MAXIMO_LOGIN_MS,
      });
      if (respuesta.status === 429) throw new ErrorApi('limite', 429);
      if (respuesta.status >= 400 && respuesta.status < 500) {
        throw new ErrorApi('credenciales', respuesta.status);
      }
      if (!respuesta.ok) throw new ErrorApi('servidor', respuesta.status);
      const cuerpo = await leerJson(respuesta);
      if (!esObjeto(cuerpo) || typeof cuerpo.token !== 'string' || cuerpo.token.length === 0) {
        throw new ErrorApi('servidor', respuesta.status);
      }
      const usuaria = cuerpo.usuaria;
      if (
        !esObjeto(usuaria) ||
        (typeof usuaria.id !== 'string' && typeof usuaria.id !== 'number') ||
        typeof usuaria.email !== 'string'
      ) {
        throw new ErrorApi('servidor', respuesta.status);
      }
      return {
        token: cuerpo.token,
        sesion: { usuaria_id: String(usuaria.id), email: usuaria.email },
      };
    },

    async logout(token) {
      const respuesta = await pedir('POST', '/api/cuentas/logout/', { token });
      if (!respuesta.ok) throw errorGenerico(respuesta);
    },

    async descargarInstantanea(token) {
      const respuesta = await pedir('GET', '/api/clinica/restaurar/', {
        token,
        tiempoMaximoMs: TIEMPO_MAXIMO_SYNC_MS,
      });
      if (!respuesta.ok) throw errorGenerico(respuesta);
      // El repositorio valida la estructura antes de guardar nada.
      return (await leerJson(respuesta)) as InstantaneaServidor;
    },

    async enviarOperaciones(token, operaciones) {
      const respuesta = await pedir('POST', '/api/clinica/sincronizar/', {
        token,
        // `intentos` es un contador local: no viaja al servidor.
        cuerpo: { operaciones: operaciones.map(({ intentos: _local, ...operacion }) => operacion) },
        tiempoMaximoMs: TIEMPO_MAXIMO_SYNC_MS,
      });
      if (!respuesta.ok) throw errorGenerico(respuesta);
      const cuerpo = await leerJson(respuesta);
      const resultados = esObjeto(cuerpo) ? cuerpo.resultados : undefined;
      if (!Array.isArray(resultados) || resultados.length !== operaciones.length) {
        throw new ErrorApi('servidor', respuesta.status);
      }
      return resultados.map((resultado: unknown, posicion): ResultadoOperacionSync => {
        const estado = esObjeto(resultado)
          ? ESTADOS_RESULTADO_SYNC.find((valor) => valor === resultado.estado)
          : undefined;
        const operacion = operaciones[posicion];
        // Cada resultado debe corresponder a la operación enviada en su posición.
        if (
          !esObjeto(resultado) ||
          estado === undefined ||
          operacion === undefined ||
          resultado.op_id !== operacion.op_id
        ) {
          throw new ErrorApi('servidor', respuesta.status);
        }
        const codigo = resultado.codigo_http;
        return {
          op_id: operacion.op_id,
          estado,
          codigo_http: typeof codigo === 'number' ? codigo : estado === 'rechazada' ? 400 : 200,
        };
      });
    },
  };
}
