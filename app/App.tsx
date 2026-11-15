import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';

import { almacenSeguroExpo, crearRepositorioSQLite } from './src/data/fabrica';
import { CompuertaAcceso, ProveedorAcceso } from './src/modules/acceso/ContextoAcceso';
import { crearClienteApi } from './src/modules/acceso/api';
import { autenticadorExpo } from './src/modules/acceso/autenticacionLocal';
import { GestorAcceso } from './src/modules/acceso/gestorAcceso';
import { E2Agenda } from './src/pantallas/E2Agenda';

function crearGestor(): GestorAcceso {
  return new GestorAcceso({
    repositorio: crearRepositorioSQLite(),
    almacenSeguro: almacenSeguroExpo,
    autenticador: autenticadorExpo,
    api: crearClienteApi({
      // Definir EXPO_PUBLIC_API_URL en .env (ver .env.example). HTTP solo se admite en desarrollo.
      urlBase: process.env.EXPO_PUBLIC_API_URL ?? '',
      permitirHttp: __DEV__,
    }),
  });
}

export default function App() {
  const [gestor] = useState(crearGestor);
  return (
    <ProveedorAcceso gestor={gestor}>
      <StatusBar style="dark" />
      <CompuertaAcceso>
        <E2Agenda />
      </CompuertaAcceso>
    </ProveedorAcceso>
  );
}
