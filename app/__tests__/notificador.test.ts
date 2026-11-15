import { conNotificacionDeCambios } from '../src/modules/sincronizacion/notificador';
import { crearRepositorioMemoria } from './ayudas/entorno';

describe('conNotificacionDeCambios', () => {
  it('avisa tras cada escritura clínica y no tras lecturas ni operaciones técnicas', async () => {
    const notificar = jest.fn(async () => undefined);
    const repo = conNotificacionDeCambios(crearRepositorioMemoria(), notificar);

    const paciente = await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente' });
    expect(paciente.nombre).toBe('Paciente');
    expect(notificar).toHaveBeenCalledTimes(1);

    await repo.actualizarPaciente(paciente.id, { nombre: 'Otro' });
    expect(notificar).toHaveBeenCalledTimes(2);

    await repo.listarPacientes();
    await repo.obtenerPaciente(paciente.id);
    await repo.listarColaSync();
    expect(notificar).toHaveBeenCalledTimes(2);

    await repo.archivarPaciente(paciente.id);
    expect(notificar).toHaveBeenCalledTimes(3);
  });

  it('un fallo al notificar no rompe el guardado', async () => {
    const repo = conNotificacionDeCambios(crearRepositorioMemoria(), async () => {
      throw new Error('fallo de red');
    });
    const paciente = await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente' });
    expect((await repo.obtenerPaciente(paciente.id))?.nombre).toBe('Paciente');
  });

  it('propaga los errores del repositorio sin notificar', async () => {
    const notificar = jest.fn();
    const repo = conNotificacionDeCambios(crearRepositorioMemoria(), notificar);
    await expect(repo.actualizarPaciente('no-existe', { nombre: 'x' })).rejects.toThrow();
    expect(notificar).not.toHaveBeenCalled();
  });
});
