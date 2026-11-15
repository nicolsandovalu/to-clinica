/**
 * Máquina de estados del acceso a la app, independiente de React.
 *
 *   cargando -> politica_pendiente -> sin_sesion -> (restaurando) -> desbloqueada
 *                                                                 <-> bloqueada
 *
 * Falla cerrada: solo la fase `desbloqueada` permite mostrar datos clínicos, y
 * solo se llega a ella tras un inicio de sesión recién hecho o una
 * autenticación local exitosa.
 */
import { AlmacenSeguro, CLAVES_ALMACEN } from '../../data/almacenSeguro';
import { ErrorRepositorio, IRepositorioClinico } from '../../data/repositorio';
import { restaurarDesdeServidor } from '../sincronizacion/restauracion';
import { ClienteApi, ErrorApi, MENSAJE_LOGIN_GENERICO, Sesion } from './api';
import type { AutenticadorLocal } from './autenticacionLocal';
import { ControladorBloqueo, EstadoApp } from './controladorBloqueo';
import { VERSION_POLITICA } from './politica';

export type FaseAcceso =
  | 'cargando'
  | 'error_inicio'
  | 'politica_pendiente'
  | 'sin_sesion'
  | 'restaurando'
  | 'restauracion_fallida'
  | 'bloqueada'
  | 'desbloqueada';

export interface EstadoAcceso {
  readonly fase: FaseAcceso;
  readonly sesion: Sesion | null;
  /** Hay una acción en curso (para deshabilitar botones). */
  readonly ocupada: boolean;
  /** Mensaje para la usuaria; nunca contiene datos clínicos ni detalles técnicos. */
  readonly error: string | null;
}

export interface DependenciasAcceso {
  readonly repositorio: IRepositorioClinico;
  readonly almacenSeguro: AlmacenSeguro;
  readonly api: ClienteApi;
  readonly autenticador: AutenticadorLocal;
  readonly ahora?: () => number;
}

export const MENSAJES_ACCESO = {
  errorInicio: 'No se pudo abrir el almacenamiento seguro de la aplicación.',
  camposVacios: 'Ingresa tu correo y tu contraseña.',
  limite: 'Demasiados intentos. Espera un minuto antes de volver a intentarlo.',
  red: 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
  servidor: 'El servidor no está disponible. Inténtalo más tarde.',
  sesionExpirada: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  restauracion: 'No se pudieron restaurar tus datos. Revisa tu conexión e inténtalo de nuevo.',
  politica: 'No se pudo registrar tu aceptación. Inténtalo de nuevo.',
  sinProteccion:
    'Este teléfono no tiene bloqueo de pantalla. Configura un PIN, huella o rostro en los ajustes del teléfono para usar la aplicación.',
  desbloqueoFallido: 'No se pudo verificar tu identidad. Inténtalo de nuevo.',
  inesperado: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
} as const;

function mensajeDeErrorApi(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.tipo === 'credenciales') return MENSAJE_LOGIN_GENERICO;
    if (error.tipo === 'limite') return MENSAJES_ACCESO.limite;
    if (error.tipo === 'red') return MENSAJES_ACCESO.red;
  }
  return MENSAJES_ACCESO.servidor;
}

export class GestorAcceso {
  private estado: EstadoAcceso = { fase: 'cargando', sesion: null, ocupada: false, error: null };
  private readonly oyentes = new Set<() => void>();
  private readonly controlador: ControladorBloqueo;
  private iniciado = false;
  private politicaAceptada = false;
  /** `true` si la sesión viene de un arranque anterior: exige biometría/PIN antes de mostrar nada. */
  private requiereDesbloqueo = true;
  private colaRevocaciones: Promise<void> = Promise.resolve();

  constructor(private readonly deps: DependenciasAcceso) {
    this.controlador = new ControladorBloqueo({
      ahora: deps.ahora,
      alBloquear: () => {
        if (this.estado.fase === 'desbloqueada') this.actualizar({ fase: 'bloqueada', error: null });
      },
    });
  }

  // ---------- Suscripción (compatible con useSyncExternalStore) ----------

  readonly suscribir = (oyente: () => void): (() => void) => {
    this.oyentes.add(oyente);
    return () => {
      this.oyentes.delete(oyente);
    };
  };

  readonly obtenerEstado = (): EstadoAcceso => this.estado;

  private actualizar(cambios: Partial<EstadoAcceso>): void {
    this.estado = { ...this.estado, ...cambios };
    this.oyentes.forEach((oyente) => oyente());
  }

  /** Evita acciones simultáneas (doble toque) y mantiene `ocupada` al día. */
  private async exclusiva(tarea: () => Promise<void>): Promise<void> {
    if (this.estado.ocupada) return;
    this.actualizar({ ocupada: true, error: null });
    try {
      await tarea();
    } catch {
      // Ninguna acción debe terminar en un rechazo sin manejar; la fase no cambia.
      this.actualizar({ error: MENSAJES_ACCESO.inesperado });
    } finally {
      this.actualizar({ ocupada: false });
    }
  }

  // ---------- Arranque ----------

  async iniciar(): Promise<void> {
    if (this.iniciado) return;
    this.iniciado = true;
    this.actualizar({ fase: 'cargando', error: null });
    try {
      await this.deps.repositorio.inicializar();
      const aceptacion = await this.deps.repositorio.obtenerAceptacionPolitica(VERSION_POLITICA);
      this.politicaAceptada = aceptacion !== null;
      const sesion = await this.leerSesionGuardada();
      this.requiereDesbloqueo = true;
      this.actualizar({ sesion });
      await this.avanzar();
    } catch {
      this.iniciado = false;
      this.actualizar({ fase: 'error_inicio', error: MENSAJES_ACCESO.errorInicio });
      return;
    }
    void this.reintentarRevocaciones();
  }

  private async leerSesionGuardada(): Promise<Sesion | null> {
    const { almacenSeguro } = this.deps;
    const token = await almacenSeguro.obtener(CLAVES_ALMACEN.token);
    const texto = await almacenSeguro.obtener(CLAVES_ALMACEN.usuaria);
    if (token !== null && texto !== null) {
      try {
        const valor: unknown = JSON.parse(texto);
        if (typeof valor === 'object' && valor !== null) {
          const { usuaria_id: usuariaId, email } = valor as Record<string, unknown>;
          if (typeof usuariaId === 'string' && typeof email === 'string') {
            return { usuaria_id: usuariaId, email };
          }
        }
      } catch {
        // Sesión guardada ilegible: se trata como si no hubiera sesión.
      }
    }
    if (token !== null || texto !== null) await this.borrarSesionLocal();
    return null;
  }

  private async borrarSesionLocal(): Promise<void> {
    const { almacenSeguro } = this.deps;
    await almacenSeguro.eliminar(CLAVES_ALMACEN.token);
    await almacenSeguro.eliminar(CLAVES_ALMACEN.usuaria);
    await almacenSeguro.eliminar(CLAVES_ALMACEN.restauracionPendiente);
  }

  /** Decide la fase siguiente según política, sesión, restauración pendiente y bloqueo. */
  private async avanzar(): Promise<void> {
    if (!this.politicaAceptada) {
      this.actualizar({ fase: 'politica_pendiente' });
      return;
    }
    if (this.estado.sesion === null) {
      this.actualizar({ fase: 'sin_sesion' });
      return;
    }
    const pendiente = await this.deps.almacenSeguro.obtener(CLAVES_ALMACEN.restauracionPendiente);
    if (pendiente !== null && !(await this.restaurar())) return;
    if (this.requiereDesbloqueo) {
      this.actualizar({ fase: 'bloqueada' });
    } else {
      this.controlador.desbloquear();
      this.actualizar({ fase: 'desbloqueada' });
    }
  }

  /** Devuelve `true` si la restauración terminó y se puede continuar. */
  private async restaurar(): Promise<boolean> {
    const { almacenSeguro, api, repositorio } = this.deps;
    this.actualizar({ fase: 'restaurando', error: null });
    const token = await almacenSeguro.obtener(CLAVES_ALMACEN.token);
    try {
      if (token === null) throw new ErrorApi('no_autorizado');
      await restaurarDesdeServidor(api, repositorio, token);
    } catch (error) {
      if (error instanceof ErrorApi && error.tipo === 'no_autorizado') {
        await this.borrarSesionLocal();
        this.actualizar({ fase: 'sin_sesion', sesion: null, error: MENSAJES_ACCESO.sesionExpirada });
        return false;
      }
      // Si ya hay datos locales no hay nada que restaurar: se continúa.
      if (!(error instanceof ErrorRepositorio && error.codigo === 'no_vacio')) {
        this.actualizar({ fase: 'restauracion_fallida', error: MENSAJES_ACCESO.restauracion });
        return false;
      }
    }
    await almacenSeguro.eliminar(CLAVES_ALMACEN.restauracionPendiente);
    return true;
  }

  // ---------- Acciones de la usuaria ----------

  /** C1: aceptación explícita. Guarda versión y fecha y encola su sincronización. */
  aceptarPolitica(): Promise<void> {
    return this.exclusiva(async () => {
      if (this.estado.fase !== 'politica_pendiente') return;
      try {
        await this.deps.repositorio.registrarAceptacionPolitica({
          version: VERSION_POLITICA,
          usuaria_id: this.estado.sesion?.usuaria_id ?? null,
        });
      } catch {
        this.actualizar({ error: MENSAJES_ACCESO.politica });
        return;
      }
      this.politicaAceptada = true;
      await this.avanzar();
    });
  }

  /** E1: inicio de sesión; en un dispositivo nuevo restaura antes de abrir la Agenda. */
  iniciarSesion(email: string, password: string): Promise<void> {
    return this.exclusiva(async () => {
      if (this.estado.fase !== 'sin_sesion') return;
      const correo = email.trim();
      if (correo.length === 0 || password.length === 0) {
        this.actualizar({ error: MENSAJES_ACCESO.camposVacios });
        return;
      }
      const { almacenSeguro, api, repositorio } = this.deps;
      let respuesta;
      try {
        respuesta = await api.login(correo, password);
      } catch (error) {
        this.actualizar({ error: mensajeDeErrorApi(error) });
        return;
      }
      await almacenSeguro.guardar(CLAVES_ALMACEN.token, respuesta.token);
      await almacenSeguro.guardar(CLAVES_ALMACEN.usuaria, JSON.stringify(respuesta.sesion));
      if (await repositorio.estaVacio()) {
        await almacenSeguro.guardar(CLAVES_ALMACEN.restauracionPendiente, '1');
      }
      this.requiereDesbloqueo = false;
      this.actualizar({ sesion: respuesta.sesion });
      await this.avanzar();
      void this.reintentarRevocaciones();
    });
  }

  reintentarRestauracion(): Promise<void> {
    return this.exclusiva(async () => {
      if (this.estado.fase !== 'restauracion_fallida') return;
      await this.avanzar();
    });
  }

  /** Pide huella, rostro o PIN del dispositivo. */
  desbloquear(): Promise<void> {
    return this.exclusiva(async () => {
      if (this.estado.fase !== 'bloqueada') return;
      const resultado = await this.deps.autenticador.autenticar();
      if (this.estado.fase !== 'bloqueada') return;
      if (resultado.ok) {
        this.requiereDesbloqueo = false;
        this.controlador.desbloquear();
        this.actualizar({ fase: 'desbloqueada' });
      } else if (resultado.motivo === 'sin_proteccion') {
        this.actualizar({ error: MENSAJES_ACCESO.sinProteccion });
      } else if (resultado.motivo === 'fallida') {
        this.actualizar({ error: MENSAJES_ACCESO.desbloqueoFallido });
      }
    });
  }

  /**
   * Revoca el token en el servidor; si no se puede (sin conexión), la revocación
   * queda encolada. El token local se elimina siempre.
   */
  cerrarSesion(): Promise<void> {
    return this.exclusiva(async () => {
      if (this.estado.sesion === null) return;
      const { almacenSeguro, api } = this.deps;
      const token = await almacenSeguro.obtener(CLAVES_ALMACEN.token);
      this.requiereDesbloqueo = true;
      await this.borrarSesionLocal();
      this.actualizar({ fase: 'sin_sesion', sesion: null, error: null });
      this.controlador.bloquear();
      if (token === null) return;
      try {
        await api.logout(token);
      } catch (error) {
        // 401: el token ya no es válido en el servidor, no hay nada que revocar.
        if (!(error instanceof ErrorApi && error.tipo === 'no_autorizado')) {
          await this.encolarRevocacion(token);
        }
      }
    });
  }

  // ---------- Revocaciones pendientes ----------

  private async leerRevocaciones(): Promise<string[]> {
    const texto = await this.deps.almacenSeguro.obtener(CLAVES_ALMACEN.revocacionesPendientes);
    if (texto === null) return [];
    try {
      const valor: unknown = JSON.parse(texto);
      return Array.isArray(valor) ? valor.filter((t): t is string => typeof t === 'string') : [];
    } catch {
      return [];
    }
  }

  private async guardarRevocaciones(tokens: string[]): Promise<void> {
    const { almacenSeguro } = this.deps;
    if (tokens.length === 0) {
      await almacenSeguro.eliminar(CLAVES_ALMACEN.revocacionesPendientes);
    } else {
      await almacenSeguro.guardar(CLAVES_ALMACEN.revocacionesPendientes, JSON.stringify(tokens));
    }
  }

  private enSerie(tarea: () => Promise<void>): Promise<void> {
    this.colaRevocaciones = this.colaRevocaciones.then(tarea, tarea).catch(() => undefined);
    return this.colaRevocaciones;
  }

  private encolarRevocacion(token: string): Promise<void> {
    return this.enSerie(async () => {
      const tokens = await this.leerRevocaciones();
      if (!tokens.includes(token)) await this.guardarRevocaciones([...tokens, token]);
    });
  }

  /** Reintenta revocar en el servidor los tokens de cierres de sesión hechos sin conexión. */
  reintentarRevocaciones(): Promise<void> {
    return this.enSerie(async () => {
      const tokens = await this.leerRevocaciones();
      if (tokens.length === 0) return;
      const fallidos: string[] = [];
      for (const token of tokens) {
        try {
          await this.deps.api.logout(token);
        } catch (error) {
          if (!(error instanceof ErrorApi && error.tipo === 'no_autorizado')) fallidos.push(token);
        }
      }
      await this.guardarRevocaciones(fallidos);
    });
  }

  // ---------- Bloqueo por inactividad / segundo plano ----------

  registrarActividad(): void {
    this.controlador.registrarActividad();
  }

  alCambiarEstadoApp(estado: EstadoApp): void {
    this.controlador.alCambiarEstadoApp(estado);
    if (estado === 'active') void this.reintentarRevocaciones();
  }

  destruir(): void {
    this.controlador.detener();
    this.oyentes.clear();
  }
}
