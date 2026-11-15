import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';

import { almacenSeguroExpo, crearRepositorioSQLite } from './src/data/fabrica';
import type { IRepositorioClinico } from './src/data/repositorio';
import { CompuertaAcceso, ProveedorAcceso, useAcceso } from './src/modules/acceso/ContextoAcceso';
import { crearClienteApi } from './src/modules/acceso/api';
import { autenticadorExpo } from './src/modules/acceso/autenticacionLocal';
import { GestorAcceso } from './src/modules/acceso/gestorAcceso';
import type { MotorSync } from './src/modules/sincronizacion/motorSync';
import { crearMotorSync } from './src/modules/sincronizacion/useSincronizacion';
import { Principal } from './src/pantallas/Principal';

interface Servicios {
  readonly repositorio: IRepositorioClinico;
  readonly gestor: GestorAcceso;
  readonly motor: MotorSync;
}

function crearServicios(): Servicios {
  const repositorio = crearRepositorioSQLite();
  const api = crearClienteApi({
    // Definir EXPO_PUBLIC_API_URL en .env (ver .env.example). HTTP solo se admite en desarrollo.
    urlBase: process.env.EXPO_PUBLIC_API_URL ?? '',
    permitirHttp: __DEV__,
  });
  const gestor = new GestorAcceso({
    repositorio,
    almacenSeguro: almacenSeguroExpo,
    autenticador: autenticadorExpo,
    api,
  });
  const motor = crearMotorSync({ repositorio, api, almacenSeguro: almacenSeguroExpo });
  return { repositorio, gestor, motor };
}

/** Solo se monta con la app desbloqueada (ver `CompuertaAcceso`). */
function ContenidoDesbloqueado({ servicios }: { servicios: Servicios }) {
  const { estado } = useAcceso();
  if (estado.sesion === null) return null;
  return (
    <Principal
      repositorio={servicios.repositorio}
      motor={servicios.motor}
      gestor={servicios.gestor}
      sesion={estado.sesion}
    />
  );
}

export default function App() {
  const [servicios] = useState(crearServicios);
  return (
    <ProveedorAcceso gestor={servicios.gestor}>
      <StatusBar style="dark" />
      <CompuertaAcceso>
        <ContenidoDesbloqueado servicios={servicios} />
      </CompuertaAcceso>
    </ProveedorAcceso>
  );
}
