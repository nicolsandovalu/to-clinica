/** E2 — Agenda. Marcador de posición: el contenido se implementa con el módulo pacientes-agenda. */
import React from 'react';

import { useAcceso } from '../modules/acceso/ContextoAcceso';
import { BotonSecundario } from '../ui/componentes';
import { Pantalla, Parrafo, Titulo } from './base';

export function E2Agenda() {
  const { gestor, estado } = useAcceso();
  return (
    <Pantalla testID="pantalla-agenda">
      <Titulo>Agenda</Titulo>
      <Parrafo>Aún no hay citas para mostrar.</Parrafo>
      <BotonSecundario
        titulo="Cerrar sesión"
        onPress={() => void gestor.cerrarSesion()}
        deshabilitado={estado.ocupada}
        accessibilityHint="Cierra tu sesión en este teléfono"
      />
    </Pantalla>
  );
}
