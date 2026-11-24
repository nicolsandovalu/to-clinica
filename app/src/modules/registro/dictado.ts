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

/** Tiempo máximo de espera del texto final tras pulsar Detener. */
export const TIEMPO_ESPERA_FIN_MS = 5000;

/** Mensaje claro para el código de error del reconocedor (nunca contiene texto clínico). */
export function mensajeErrorDictado(codigo: string): string {
  switch (codigo) {
    case 'not-allowed':
      return 'Falta el permiso del micrófono. Actívalo en los ajustes de la aplicación.';
    case 'no-speech':
      return 'No se escuchó nada. Pulsa Dictar y habla cerca del teléfono.';
    case 'language-not-supported':
    case 'service-not-allowed':
      return 'Este teléfono no tiene el español sin conexión instalado. Descárgalo en los ajustes de voz del teléfono o escribe con el teclado.';
    case 'audio-capture':
      return 'No se pudo usar el micrófono. Revisa que otra aplicación no lo esté usando.';
    case 'terminado-solo':
      return 'El teléfono cerró el micrófono enseguida. Revisa que el español esté instalado para uso sin conexión en los ajustes de voz, o escribe con el teclado.';
    case 'aborted':
      return '';
    default:
      return `El dictado se detuvo (${codigo}). Puedes escribir con el teclado.`;
  }
}

/** Superficie mínima del motor nativo; permite inyectar un doble en las pruebas. */
export interface MotorDictado {
  /** `true` si hay reconocimiento on-device utilizable en el teléfono. */
  soportaOnDevice(): boolean;
  /** Pide micrófono + reconocimiento; `true` solo si ambos fueron concedidos. */
  pedirPermisos(): Promise<boolean>;
  /**
   * Revisa qué idiomas hay instalados para uso sin conexión y elige el español.
   * Opcional: sin él se usa el idioma y el servicio predeterminados.
   */
  resolverIdioma?(): Promise<ResolucionIdioma>;
  iniciar(opciones: OpcionesInicioDictado): void;
  detener(): void;
  /** Registra oyentes; devuelve la función que los retira. */
  suscribir(oyentes: OyentesMotorDictado): () => void;
}

export type ResolucionIdioma =
  | { readonly tipo: 'predeterminado' }
  | { readonly tipo: 'usar'; readonly lang: string; readonly paqueteAndroid: string }
  | { readonly tipo: 'sin_idioma' };

/** Servicio de reconocimiento sin conexión de Google en Android. */
export const PAQUETE_VOZ_ON_DEVICE = 'com.google.android.as';

export interface OpcionesInicioDictado {
  readonly androidRecognitionServicePackage?: string;
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
      resolverIdioma: async (): Promise<ResolucionIdioma> => {
        try {
          const { installedLocales } = await modulo.getSupportedLocales({
            androidRecognitionServicePackage: PAQUETE_VOZ_ON_DEVICE,
          });
          // Lista vacía: no se puede saber (otro servicio o Android antiguo); se usa el predeterminado.
          if (installedLocales.length === 0) return { tipo: 'predeterminado' };
          const preferido =
            installedLocales.find((l) => l.replace('_', '-').toLowerCase() === IDIOMA_DICTADO.toLowerCase()) ??
            installedLocales.find((l) => l.toLowerCase().startsWith('es'));
          return preferido === undefined
            ? { tipo: 'sin_idioma' }
            : { tipo: 'usar', lang: preferido.replace('_', '-'), paqueteAndroid: PAQUETE_VOZ_ON_DEVICE };
        } catch {
          return { tipo: 'predeterminado' };
        }
      },
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
  /** Código de error del reconocedor, para mostrar un aviso al usuario. */
  readonly alError?: (codigo: string) => void;
}

/**
 * Controla un dictado a la vez: iniciar en otro campo detiene el anterior.
 * No tiene dependencias de React; la pantalla solo conecta callbacks.
 */
export class ControladorDictado {
  private estado: EstadoDictado = { disponible: true, escuchando: false, aviso: null };
  private campoActivo: string | null = null;
  private retirar: (() => void) | null = null;
  private inicioMs = 0;
  private huboResultado = false;
  private deteniendo = false;
  private temporizadorFin: ReturnType<typeof setTimeout> | null = null;

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
    if (this.campoActivo !== null) this.detenerYa();
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
    let opciones: OpcionesInicioDictado = OPCIONES_DICTADO;
    try {
      const idioma = (await motor.resolverIdioma?.()) ?? { tipo: 'predeterminado' as const };
      if (idioma.tipo === 'sin_idioma') {
        this.opciones.alError?.('language-not-supported');
        return;
      }
      if (idioma.tipo === 'usar') {
        opciones = { ...OPCIONES_DICTADO, lang: idioma.lang, androidRecognitionServicePackage: idioma.paqueteAndroid };
      }
    } catch {
      opciones = OPCIONES_DICTADO;
    }
    this.campoActivo = campo;
    this.inicioMs = Date.now();
    this.huboResultado = false;
    this.retirar = motor.suscribir({
      resultado: (texto) => {
        this.huboResultado = true;
        if (this.campoActivo !== null) this.opciones.alTexto(this.campoActivo, texto);
      },
      fin: () => {
        // El reconocedor se cerró solo (no fue el botón Detener): si fue casi al instante y sin texto, se avisa.
        const sinQueNadieLoPida = this.campoActivo !== null && !this.deteniendo;
        const muyRapido = Date.now() - this.inicioMs < 3000 && !this.huboResultado;
        this.terminar();
        if (sinQueNadieLoPida && muyRapido) this.opciones.alError?.('terminado-solo');
      },
      error: (codigo) => {
        this.terminar();
        this.opciones.alError?.(codigo);
      },
    });
    try {
      motor.iniciar(opciones);
      this.fijar({ ...this.estado, escuchando: true });
    } catch {
      this.terminar();
      this.marcarNoDisponible();
    }
  }

  /**
   * Pide detener, pero mantiene los oyentes hasta el evento `fin`: el reconocedor entrega el texto
   * final después de detenerse y descartarlo antes perdería lo dictado.
   */
  detener(): void {
    if (this.campoActivo === null || this.deteniendo) return;
    this.deteniendo = true;
    try {
      this.motor?.detener();
    } catch {
      // El motor ya estaba detenido.
    }
    this.fijar({ ...this.estado, escuchando: false });
    if (this.campoActivo !== null) {
      this.temporizadorFin = setTimeout(() => this.terminar(), TIEMPO_ESPERA_FIN_MS);
    }
  }

  /** Libera oyentes; llamar al desmontar la pantalla. */
  liberar(): void {
    this.detenerYa();
  }

  private detenerYa(): void {
    if (this.campoActivo === null) return;
    try {
      this.motor?.detener();
    } catch {
      // El motor ya estaba detenido.
    }
    this.terminar();
  }

  private terminar(): void {
    if (this.temporizadorFin !== null) clearTimeout(this.temporizadorFin);
    this.temporizadorFin = null;
    this.deteniendo = false;
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
