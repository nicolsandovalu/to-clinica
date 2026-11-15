/**
 * Dictado por voz on-device (CLAUDE.md §1 y §4).
 *
 * - Reconocimiento en español con `requiresOnDeviceRecognition: true`: el audio no sale del teléfono.
 * - `recordingOptions.persist: false`: jamás se guarda un archivo de audio.
 * - Si falta permiso o motor on-device, `disponible = false` y el teclado sigue activo.
 * - Nunca se escribe texto clínico en logs (CS-07).
 */

export const AVISO_DICTADO_NO_DISPONIBLE = 'Dictado por voz no disponible';
export const IDIOMA_DICTADO = 'es-CL';

/** Superficie mínima del motor nativo; permite inyectar un doble en las pruebas. */
export interface MotorDictado {
  /** `true` si hay reconocimiento on-device utilizable en el teléfono. */
  soportaOnDevice(): boolean;
  /** Pide micrófono + reconocimiento; `true` solo si ambos fueron concedidos. */
  pedirPermisos(): Promise<boolean>;
  iniciar(opciones: OpcionesInicioDictado): void;
  detener(): void;
  /** Registra oyentes; devuelve la función que los retira. */
  suscribir(oyentes: OyentesMotorDictado): () => void;
}

export interface OpcionesInicioDictado {
  readonly lang: string;
  readonly requiresOnDeviceRecognition: true;
  readonly interimResults: false;
  readonly continuous: true;
  readonly recordingOptions: { readonly persist: false };
}

export interface OyentesMotorDictado {
  /** Transcripción final. */
  readonly resultado: (texto: string) => void;
  readonly fin: () => void;
  /** Solo el código de error, nunca contenido. */
  readonly error: (codigo: string) => void;
}

export interface EstadoDictado {
  readonly disponible: boolean;
  readonly escuchando: boolean;
  /** Aviso visible cuando `disponible` es `false`; `null` en caso contrario. */
  readonly aviso: string | null;
}

export const OPCIONES_DICTADO: OpcionesInicioDictado = {
  lang: IDIOMA_DICTADO,
  requiresOnDeviceRecognition: true,
  interimResults: false,
  continuous: true,
  recordingOptions: { persist: false },
};

/** Anexa lo dictado al final del texto existente sin borrarlo ni duplicar espacios. */
export function anexarTexto(actual: string, dictado: string): string {
  const nuevo = dictado.trim();
  if (nuevo.length === 0) return actual;
  if (actual.trim().length === 0) return nuevo;
  return /\s$/.test(actual) ? `${actual}${nuevo}` : `${actual} ${nuevo}`;
}

/** Motor real de `expo-speech-recognition`; `null` si el módulo nativo no existe (p. ej. Expo Go, web). */
export function crearMotorExpo(): MotorDictado | null {
  try {
    // Carga diferida: importar el paquete sin módulo nativo lanza error.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExpoSpeechRecognitionModule: modulo } = require('expo-speech-recognition') as typeof import('expo-speech-recognition');
    return {
      soportaOnDevice: () => modulo.supportsOnDeviceRecognition() && modulo.isRecognitionAvailable(),
      pedirPermisos: async () => (await modulo.requestPermissionsAsync()).granted,
      iniciar: (opciones) => modulo.start(opciones),
      detener: () => modulo.stop(),
      suscribir: (oyentes) => {
        const subs = [
          modulo.addListener('result', (evento) => {
            if (!evento.isFinal) return;
            const texto = evento.results[0]?.transcript;
            if (typeof texto === 'string') oyentes.resultado(texto);
          }),
          modulo.addListener('end', () => oyentes.fin()),
          modulo.addListener('error', (evento) => oyentes.error(String(evento.error))),
        ];
        return () => subs.forEach((s) => s.remove());
      },
    };
  } catch {
    return null;
  }
}

export interface OpcionesControlador {
  /** Texto final reconocido para el campo que está dictando. */
  readonly alTexto: (campo: string, texto: string) => void;
  readonly alCambiar: (estado: EstadoDictado) => void;
}

/**
 * Controla un dictado a la vez: iniciar en otro campo detiene el anterior.
 * No tiene dependencias de React; la pantalla solo conecta callbacks.
 */
export class ControladorDictado {
  private estado: EstadoDictado = { disponible: true, escuchando: false, aviso: null };
  private campoActivo: string | null = null;
  private retirar: (() => void) | null = null;

  constructor(
    private readonly motor: MotorDictado | null,
    private readonly opciones: OpcionesControlador,
  ) {
    if (motor === null) this.fijar({ disponible: false, escuchando: false, aviso: AVISO_DICTADO_NO_DISPONIBLE });
  }

  obtenerEstado(): EstadoDictado {
    return this.estado;
  }

  get campo(): string | null {
    return this.campoActivo;
  }

  /** Comprueba permisos y motor on-device. Sin ellos queda `disponible = false`. */
  async iniciar(campo: string): Promise<void> {
    const motor = this.motor;
    if (motor === null || !this.estado.disponible) return;
    if (this.campoActivo !== null) this.detener();
    let permitido = false;
    try {
      permitido = motor.soportaOnDevice() && (await motor.pedirPermisos());
    } catch {
      permitido = false;
    }
    if (!permitido) {
      this.marcarNoDisponible();
      return;
    }
    this.campoActivo = campo;
    this.retirar = motor.suscribir({
      resultado: (texto) => {
        if (this.campoActivo !== null) this.opciones.alTexto(this.campoActivo, texto);
      },
      fin: () => this.terminar(),
      error: () => this.terminar(),
    });
    try {
      motor.iniciar(OPCIONES_DICTADO);
      this.fijar({ ...this.estado, escuchando: true });
    } catch {
      this.terminar();
      this.marcarNoDisponible();
    }
  }

  detener(): void {
    if (this.campoActivo === null) return;
    try {
      this.motor?.detener();
    } catch {
      // El motor ya estaba detenido.
    }
    this.terminar();
  }

  /** Libera oyentes; llamar al desmontar la pantalla. */
  liberar(): void {
    this.detener();
  }

  private terminar(): void {
    this.retirar?.();
    this.retirar = null;
    this.campoActivo = null;
    this.fijar({ ...this.estado, escuchando: false });
  }

  private marcarNoDisponible(): void {
    this.fijar({ disponible: false, escuchando: false, aviso: AVISO_DICTADO_NO_DISPONIBLE });
  }

  private fijar(estado: EstadoDictado): void {
    this.estado = estado;
    this.opciones.alCambiar(estado);
  }
}
