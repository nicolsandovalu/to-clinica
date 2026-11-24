/**
 * Sistema de diseño. Todas las combinaciones texto/fondo declaradas en
 * `PARES_CONTRASTE` cumplen razón de contraste >= 4.5:1 (WCAG 2.2 AA, 1.4.3);
 * `__tests__/tema.test.ts` lo verifica.
 */

export const colores = {
  primario: '#155E75',
  primarioPresionado: '#0E4557',
  sobrePrimario: '#FFFFFF',
  fondo: '#F7F8FA',
  superficie: '#FFFFFF',
  texto: '#1F2937',
  textoSecundario: '#4B5563',
  borde: '#6B7280',
  /** Borde decorativo de tarjetas (no delimita controles). */
  bordeSuave: '#E2E8F0',
  avatarFondo: '#CFE8EF',
  avatarTexto: '#0E4557',
  deshabilitadoFondo: '#E5E7EB',
  deshabilitadoTexto: '#4B5563',
  foco: '#1D4ED8',

  exito: '#166534',
  exitoFondo: '#DCFCE7',
  advertencia: '#92400E',
  advertenciaFondo: '#FEF3C7',
  error: '#991B1B',
  errorFondo: '#FEE2E2',
  info: '#1E40AF',
  infoFondo: '#DBEAFE',
  neutro: '#374151',
  neutroFondo: '#E5E7EB',
} as const;

export type VarianteSemantica = 'exito' | 'advertencia' | 'error' | 'info' | 'neutro';

export const coloresSemanticos: Record<VarianteSemantica, { texto: string; fondo: string }> = {
  exito: { texto: colores.exito, fondo: colores.exitoFondo },
  advertencia: { texto: colores.advertencia, fondo: colores.advertenciaFondo },
  error: { texto: colores.error, fondo: colores.errorFondo },
  info: { texto: colores.info, fondo: colores.infoFondo },
  neutro: { texto: colores.neutro, fondo: colores.neutroFondo },
};

/** Tamaños en puntos escalables: respetan el tamaño de fuente del sistema. */
export const tipografia = {
  titulo: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  subtitulo: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  cuerpo: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  cuerpoDestacado: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  etiqueta: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  auxiliar: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
} as const;

/** Tope de escalado para que la interfaz siga siendo utilizable con fuentes muy grandes. */
export const ESCALA_FUENTE_MAXIMA = 2;

export const espaciado = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

export const radios = { s: 8, m: 12, l: 16, completo: 999 } as const;

/** Área táctil mínima (WCAG 2.5.8 exige 24; se usa 48 por recomendación de plataforma). */
export const AREA_TACTIL_MINIMA = 48;

export const CONTRASTE_MINIMO = 4.5;

function luminancia(hex: string): number {
  const canales = [1, 3, 5].map((inicio) => {
    const canal = parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
    return canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (canales[0] ?? 0) + 0.7152 * (canales[1] ?? 0) + 0.0722 * (canales[2] ?? 0);
}

/** Razón de contraste WCAG entre dos colores `#RRGGBB`. */
export function razonContraste(colorA: string, colorB: string): number {
  const a = luminancia(colorA);
  const b = luminancia(colorB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Pares [texto, fondo] realmente usados por los componentes. */
export const PARES_CONTRASTE: readonly (readonly [string, string])[] = [
  [colores.sobrePrimario, colores.primario],
  [colores.sobrePrimario, colores.primarioPresionado],
  [colores.primario, colores.fondo],
  [colores.primario, colores.superficie],
  [colores.texto, colores.fondo],
  [colores.texto, colores.superficie],
  [colores.textoSecundario, colores.fondo],
  [colores.textoSecundario, colores.superficie],
  [colores.borde, colores.fondo],
  [colores.borde, colores.superficie],
  [colores.deshabilitadoTexto, colores.deshabilitadoFondo],
  [colores.error, colores.fondo],
  [colores.error, colores.superficie],
  [colores.foco, colores.fondo],
  [colores.avatarTexto, colores.avatarFondo],
  ...Object.values(coloresSemanticos).map(({ texto, fondo }) => [texto, fondo] as const),
];
