export const getRadarPosition = (mapData, entityCoords) => {
  // Both args can legitimately be missing: mapData is undefined until the map
  // data.json loads, and callers may have no coords. Dereferencing either threw a
  // TypeError that took the whole React tree down, so guard up front.
  if (!mapData || !entityCoords) {
    return { x: 0, y: 0 };
  }

  if (!entityCoords.x || !entityCoords.y) {
    return { x: 0, y: 0 };
  }

  if (!mapData.x || !mapData.y) {
    return { x: 0, y: 0 };
  }

  let px = (entityCoords.x - mapData.x) / mapData.scale / 1024;
  let py = (((entityCoords.y - mapData.y) / mapData.scale) * -1.0) / 1024;

  const zoom = mapData.zoom || 1;
  if (zoom !== 1) {
    px = (px - 0.5) / zoom + 0.5;
    py = (py - 0.5) / zoom + 0.5;
  }

  const rotate = mapData.rotate || 0;
  if (rotate === 1) {
    const cx = px - 0.5;
    const cy = py - 0.5;
    px = 0.5 + cy;
    py = 0.5 - cx;
  } else if (rotate === 2) {
    const cx = px - 0.5;
    const cy = py - 0.5;
    px = 0.5 - cy;
    py = 0.5 + cx;
  } else if (rotate === 3) {
    px = 1 - px;
    py = 1 - py;
  }

  return { x: px, y: py };
};

export const playerColors = [
  // blue
  "#84c8ed",

  // green
  "#009a7d",

  // yellow
  "#eadd40",

  // orange
  "#df7d29",

  // purple
  "#b72b92",

  // white
  "#ffffff",
];

export const teamEnum = {
  none: 0,
  spectator: 1,
  terrorist: 2,
  counterTerrorist: 3,
};