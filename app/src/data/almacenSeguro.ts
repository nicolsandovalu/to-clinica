/** Almacén de secretos del dispositivo (Keychain / Keystore). */
export interface AlmacenSeguro {
  obtener(clave: string): Promise<string | null>;
  guardar(clave: string, valor: string): Promise<void>;
  eliminar(clave: string): Promise<void>;
}

/** Nombres de las entradas; `expo-secure-store` solo admite letras, números, `.`, `-` y `_`. */
export const CLAVES_ALMACEN = {
  claveBaseDatos: 'to_clinica.clave_bd',
  token: 'to_clinica.token',
  usuaria: 'to_clinica.usuaria',
  restauracionPendiente: 'to_clinica.restauracion_pendiente',
  revocacionesPendientes: 'to_clinica.revocaciones_pendientes',
} as const;

/** Implementación en memoria para pruebas. */
export class AlmacenSeguroMemoria implements AlmacenSeguro {
  private readonly valores = new Map<string, string>();

  async obtener(clave: string): Promise<string | null> {
    return this.valores.get(clave) ?? null;
  }

  async guardar(clave: string, valor: string): Promise<void> {
    this.valores.set(clave, valor);
  }

  async eliminar(clave: string): Promise<void> {
    this.valores.delete(clave);
  }
}
