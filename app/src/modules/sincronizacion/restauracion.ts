import type { IRepositorioClinico } from '../../data/repositorio';
import type { InstantaneaServidor } from '../../data/tipos';

export interface FuenteRestauracion {
  descargarInstantanea(token: string): Promise<InstantaneaServidor>;
}

/**
 * Restauración completa en un dispositivo nuevo: descarga la copia del servidor
 * y la carga de forma atómica en el repositorio local vacío.
 */
export async function restaurarDesdeServidor(
  fuente: FuenteRestauracion,
  repositorio: IRepositorioClinico,
  token: string,
): Promise<void> {
  const instantanea = await fuente.descargarInstantanea(token);
  await repositorio.restaurarDesdeServidor(instantanea);
  await repositorio.registrarEventoSync({
    tipo: 'restauracion',
    entidad: null,
    registro_id: null,
    op_id: null,
    codigo_http: 200,
  });
}
