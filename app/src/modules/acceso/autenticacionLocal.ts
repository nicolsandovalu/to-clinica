/** Desbloqueo con huella, rostro o PIN/patrón del dispositivo (`expo-local-authentication`). */
import * as LocalAuthentication from 'expo-local-authentication';

export type ResultadoAutenticacion =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: 'sin_proteccion' | 'cancelada' | 'fallida' };

export interface AutenticadorLocal {
  autenticar(): Promise<ResultadoAutenticacion>;
}

const MOTIVOS_CANCELACION: readonly string[] = ['user_cancel', 'system_cancel', 'app_cancel'];
const MOTIVOS_SIN_PROTECCION: readonly string[] = ['not_enrolled', 'passcode_not_set', 'not_available'];

export const autenticadorExpo: AutenticadorLocal = {
  async autenticar() {
    try {
      // Sin bloqueo de pantalla configurado no hay con qué verificar: se niega el acceso.
      const nivel = await LocalAuthentication.getEnrolledLevelAsync();
      if (nivel === LocalAuthentication.SecurityLevel.NONE) {
        return { ok: false, motivo: 'sin_proteccion' };
      }
      const resultado = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquea TO Clínica',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false,
      });
      if (resultado.success) return { ok: true };
      if (MOTIVOS_SIN_PROTECCION.includes(resultado.error)) {
        return { ok: false, motivo: 'sin_proteccion' };
      }
      return {
        ok: false,
        motivo: MOTIVOS_CANCELACION.includes(resultado.error) ? 'cancelada' : 'fallida',
      };
    } catch {
      return { ok: false, motivo: 'fallida' };
    }
  },
};
