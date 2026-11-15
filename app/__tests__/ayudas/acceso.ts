/** Dobles de prueba para el módulo de acceso. */
import { AlmacenSeguroMemoria } from '../../src/data/almacenSeguro';
import type { IRepositorioClinico } from '../../src/data/repositorio';
import type {
  InstantaneaServidor,
  OperacionColaSync,
  ResultadoOperacionSync,
} from '../../src/data/tipos';
import { ClienteApi, ErrorApi } from '../../src/modules/acceso/api';
import type { AutenticadorLocal, ResultadoAutenticacion } from '../../src/modules/acceso/autenticacionLocal';
import { GestorAcceso } from '../../src/modules/acceso/gestorAcceso';
import { crearRepositorioMemoria } from './entorno';

export const EMAIL = 'terapeuta@ejemplo.cl';
export const PASSWORD = 'Clave#Segura1';
export const TOKEN = 'token-de-prueba';

export const INSTANTANEA_VACIA: InstantaneaServidor = {
  apoderados: [],
  pacientes: [],
  citas: [],
  registros_sesion: [],
};

export const INSTANTANEA_CON_PACIENTE: InstantaneaServidor = {
  ...INSTANTANEA_VACIA,
  pacientes: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      propietaria_id: '7',
      apoderado_id: null,
      nombre: 'Paciente del servidor',
      fecha_nacimiento: null,
      antecedentes: '',
      motivo_consulta: '',
      archivado: false,
      creado_en: '2025-01-01T10:00:00.000Z',
      modificado_en: '2025-01-01T10:00:00.000Z',
    },
  ],
};

export class ApiFalsa implements ClienteApi {
  instantanea: InstantaneaServidor = INSTANTANEA_VACIA;
  /** Si se define, la llamada correspondiente falla con este error. */
  errorLogin: ErrorApi | null = null;
  errorLogout: ErrorApi | null = null;
  errorRestauracion: ErrorApi | null = null;
  readonly llamadas: string[] = [];
  readonly tokensRevocados: string[] = [];
  private emitidos = 0;

  async login(email: string, password: string) {
    this.llamadas.push('login');
    if (this.errorLogin) throw this.errorLogin;
    if (email !== EMAIL || password !== PASSWORD) throw new ErrorApi('credenciales', 400);
    this.emitidos += 1;
    const token = this.emitidos === 1 ? TOKEN : `${TOKEN}-${this.emitidos}`;
    return { token, sesion: { usuaria_id: '7', email } };
  }

  async logout(token: string) {
    this.llamadas.push('logout');
    if (this.errorLogout) throw this.errorLogout;
    this.tokensRevocados.push(token);
  }

  async descargarInstantanea(_token: string) {
    this.llamadas.push('restauracion');
    if (this.errorRestauracion) throw this.errorRestauracion;
    return this.instantanea;
  }

  async enviarOperaciones(_token: string, operaciones: readonly OperacionColaSync[]) {
    this.llamadas.push('sincronizar');
    return operaciones.map(
      (op): ResultadoOperacionSync => ({ op_id: op.op_id, estado: 'aplicada', codigo_http: 200 }),
    );
  }
}

export class AutenticadorFalso implements AutenticadorLocal {
  resultado: ResultadoAutenticacion = { ok: true };
  intentos = 0;

  async autenticar() {
    this.intentos += 1;
    return this.resultado;
  }
}

export interface EntornoAcceso {
  readonly repositorio: IRepositorioClinico;
  readonly almacenSeguro: AlmacenSeguroMemoria;
  readonly api: ApiFalsa;
  readonly autenticador: AutenticadorFalso;
  readonly reloj: { ahora: number };
  /** Crea un gestor nuevo sobre el mismo almacenamiento: simula cerrar y volver a abrir la app. */
  crearGestor(): GestorAcceso;
  /** Detiene los temporizadores de todos los gestores creados. */
  destruir(): void;
}

export function crearEntornoAcceso(): EntornoAcceso {
  const repositorio = crearRepositorioMemoria();
  const almacenSeguro = new AlmacenSeguroMemoria();
  const api = new ApiFalsa();
  const autenticador = new AutenticadorFalso();
  const reloj = { ahora: Date.parse('2026-03-02T12:00:00.000Z') };
  const gestores: GestorAcceso[] = [];
  return {
    repositorio,
    almacenSeguro,
    api,
    autenticador,
    reloj,
    crearGestor: () => {
      const gestor = new GestorAcceso({
        repositorio,
        almacenSeguro,
        api,
        autenticador,
        ahora: () => reloj.ahora,
      });
      gestores.push(gestor);
      return gestor;
    },
    destruir: () => gestores.forEach((gestor) => gestor.destruir()),
  };
}

/** Deja un gestor con política aceptada y sesión iniciada (fase `desbloqueada`). */
export async function gestorConSesion(entorno: EntornoAcceso): Promise<GestorAcceso> {
  const gestor = entorno.crearGestor();
  await gestor.iniciar();
  await gestor.aceptarPolitica();
  await gestor.iniciarSesion(EMAIL, PASSWORD);
  return gestor;
}
