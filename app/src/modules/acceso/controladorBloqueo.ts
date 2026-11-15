/**
 * Reglas de bloqueo local (AUT-07), sin dependencias de React ni de módulos nativos.
 *
 * Los límites se evalúan con marcas de tiempo, no solo con temporizadores: en
 * segundo plano el sistema puede suspender los temporizadores de JavaScript, así
 * que al volver a primer plano (y en cada interacción) se vuelve a comprobar.
 */
export const LIMITE_INACTIVIDAD_MS = 5 * 60 * 1000;
export const LIMITE_SEGUNDO_PLANO_MS = 60 * 1000;

/** Valores de `AppState` de React Native. */
export type EstadoApp = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface DependenciasBloqueo {
  /** Se invoca una vez cada vez que la app pasa a estar bloqueada. */
  readonly alBloquear: () => void;
  /** Milisegundos actuales; por defecto `Date.now`. */
  readonly ahora?: () => number;
}

export class ControladorBloqueo {
  /** Falla cerrada: se parte bloqueada hasta un desbloqueo explícito. */
  private bloqueada = true;
  private ultimaActividad = 0;
  private enSegundoPlanoDesde: number | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private readonly ahora: () => number;

  constructor(private readonly deps: DependenciasBloqueo) {
    this.ahora = deps.ahora ?? Date.now;
  }

  estaBloqueada(): boolean {
    return this.bloqueada;
  }

  /** Llamar solo tras una autenticación local exitosa o un inicio de sesión recién hecho. */
  desbloquear(): void {
    this.bloqueada = false;
    this.ultimaActividad = this.ahora();
    this.enSegundoPlanoDesde = null;
    this.programar();
  }

  bloquear(): void {
    this.cancelarTemporizador();
    if (this.bloqueada) return;
    this.bloqueada = true;
    this.deps.alBloquear();
  }

  /** Toques y escritura de la usuaria. Si el plazo ya venció, bloquea en vez de extenderlo. */
  registrarActividad(): void {
    if (this.bloqueada || this.verificar()) return;
    this.ultimaActividad = this.ahora();
    this.programar();
  }

  alCambiarEstadoApp(estado: EstadoApp): void {
    if (this.bloqueada) return;
    if (estado === 'background') {
      if (this.enSegundoPlanoDesde === null) this.enSegundoPlanoDesde = this.ahora();
      this.programar();
    } else if (estado === 'active') {
      if (this.verificar()) return;
      this.enSegundoPlanoDesde = null;
      this.programar();
    }
  }

  detener(): void {
    this.cancelarTemporizador();
  }

  private vencimiento(): number {
    const porInactividad = this.ultimaActividad + LIMITE_INACTIVIDAD_MS;
    return this.enSegundoPlanoDesde === null
      ? porInactividad
      : Math.min(porInactividad, this.enSegundoPlanoDesde + LIMITE_SEGUNDO_PLANO_MS);
  }

  /** Bloquea si algún plazo venció. Devuelve `true` si quedó bloqueada. */
  private verificar(): boolean {
    if (!this.bloqueada && this.ahora() >= this.vencimiento()) this.bloquear();
    return this.bloqueada;
  }

  private programar(): void {
    this.cancelarTemporizador();
    const espera = Math.max(0, this.vencimiento() - this.ahora());
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      if (!this.verificar()) this.programar();
    }, espera);
  }

  private cancelarTemporizador(): void {
    if (this.temporizador !== null) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
  }
}
