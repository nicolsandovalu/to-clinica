/** Desbloqueo local (RNF-03): falla cerrada ante falta de protección, cancelación o error. */
import * as LocalAuthentication from 'expo-local-authentication';

import { autenticadorExpo } from '../src/modules/acceso/autenticacionLocal';

jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const nivel = LocalAuthentication.getEnrolledLevelAsync as jest.Mock;
const autenticar = LocalAuthentication.authenticateAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  nivel.mockResolvedValue(LocalAuthentication.SecurityLevel.SECRET);
});

describe('autenticadorExpo', () => {
  it('niega el acceso sin bloqueo de pantalla y no llega a pedir autenticación', async () => {
    nivel.mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    await expect(autenticadorExpo.autenticar()).resolves.toEqual({ ok: false, motivo: 'sin_proteccion' });
    expect(autenticar).not.toHaveBeenCalled();
  });

  it('permite el acceso cuando el sistema verifica a la usuaria', async () => {
    autenticar.mockResolvedValue({ success: true });
    await expect(autenticadorExpo.autenticar()).resolves.toEqual({ ok: true });
  });

  it.each([
    ['not_enrolled', 'sin_proteccion'],
    ['passcode_not_set', 'sin_proteccion'],
    ['not_available', 'sin_proteccion'],
    ['user_cancel', 'cancelada'],
    ['system_cancel', 'cancelada'],
    ['app_cancel', 'cancelada'],
    ['authentication_failed', 'fallida'],
  ])('error "%s" se traduce en motivo "%s"', async (error, motivo) => {
    autenticar.mockResolvedValue({ success: false, error });
    await expect(autenticadorExpo.autenticar()).resolves.toEqual({ ok: false, motivo });
  });

  it('una excepción del módulo nativo no abre la app (falla cerrada)', async () => {
    autenticar.mockRejectedValue(new Error('módulo no disponible'));
    await expect(autenticadorExpo.autenticar()).resolves.toEqual({ ok: false, motivo: 'fallida' });
  });
});
