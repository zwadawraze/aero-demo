// Процедурная модель часов AERO—41: всё собрано кодом, без внешних 3D-файлов.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;

/* ── вспомогательное ── */
const makeCanvas = size => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
const colorTex = canvas => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const poly = pts => { const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); s.closePath(); return s; };
const extrude = (shape, depth, bevel = 0) => new THREE.ExtrudeGeometry(shape, {
  depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 48,
});
function gearShape(r1, r2, teeth, hole) {
  const s = new THREE.Shape(), n = teeth * 2;
  for (let i = 0; i <= n; i++) {
    const a = i / n * TAU, r = i % 2 ? r2 : r1, x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  if (hole) { const h = new THREE.Path(); h.absarc(0, 0, hole, 0, TAU, true); s.holes.push(h); }
  return s;
}
// текст по окружности: угол считается по часовой стрелке от «12»
function arcText(c, text, cx, cy, r, start, step) {
  [...text].forEach((ch, i) => {
    const a = start + i * step;
    c.save(); c.translate(cx + Math.sin(a) * r, cy - Math.cos(a) * r); c.rotate(a); c.fillText(ch, 0, 0); c.restore();
  });
}

// Грани как у настоящего металла: выдавленную деталь делим на плоскости (торцы), стенки и фаски,
// внутри каждой поверхности нормали сглажены, а между ними остаётся чёткое ребро. bend(x, y) — прогиб по z.
function surfaces(geo, bend) {
  const p = geo.attributes.position, out = [[], [], []];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
    const k = Math.abs(n.z) > .98 ? 0 : Math.abs(n.z) < .05 ? 1 : 2;
    out[k].push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  // торцы режем на мелкие треугольники, иначе изгиб ложится крупными ломаными гранями
  for (let lvl = 0; bend && lvl < 3; lvl++) {
    const src = out[0], dst = [];
    for (let i = 0; i < src.length; i += 9) {
      const P = [0, 3, 6].map(o => [src[i + o], src[i + o + 1], src[i + o + 2]]), m = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
      const ab = m(P[0], P[1]), bc = m(P[1], P[2]), ca = m(P[2], P[0]);
      dst.push(...P[0], ...ab, ...ca, ...ab, ...P[1], ...bc, ...ca, ...bc, ...P[2], ...ab, ...bc, ...ca);
    }
    out[0] = dst;
  }
  return out.map(arr => {
    const uv = [];
    for (let i = 0; i < arr.length; i += 3) { if (bend) arr[i + 2] += bend(arr[i], arr[i + 1]); uv.push(arr[i], arr[i + 1]); }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g = mergeVertices(g, 1e-4); g.computeVertexNormals(); return g;
  });
}
// «двускатная» деталь: планка с ребром посередине — так огранены накладные метки
function roofGeo(w, len, h) {
  const l = len / 2, e = Math.min(w * 1.1, l * .6), A = [-w, -l, 0], B = [w, -l, 0], C = [w, l, 0], D = [-w, l, 0], E = [0, -l + e, h], F = [0, l - e, h];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([B, C, F, B, F, E, D, A, E, D, E, F, A, B, E, C, D, F].flat(), 3));
  g.computeVertexNormals(); return g;
}
// гранёная стрелка «дофин»: две плоскости, сходящиеся к ребру по оси
function facetHand(pts, h) {
  const w0 = pts[1][0], yb = pts[1][1], wm = pts[2][0], ym = pts[2][1], tip = pts[3][1];
  const A = [w0, yb, 0], B = [wm, ym, 0], T = [0, tip, .002], S0 = [0, yb, h], S1 = [0, ym, h], A2 = [-w0, yb, 0], B2 = [-wm, ym, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([A, B, S1, A, S1, S0, B, T, S1, A2, S1, B2, A2, S0, S1, B2, S1, T].flat(), 3));
  g.computeVertexNormals(); return g;
}

// Студийное окружение, как на предметной съёмке часов: тёмный зал и несколько ярких софтбоксов.
// На металле это даёт узкие чёткие блики и глубокие тени вместо ровной «пластиковой» засветки.
export function studioEnv(renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0b0c0f, side: THREE.BackSide })));
  const box = (w, h, x, y, z, power) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  box(16, 7, 0, 11, 4, 1.9);      // большой верхний софтбокс
  box(2.6, 14, -11, 2, 3, 3.2);     // узкая полоса слева — длинный блик по корпусу
  box(2.6, 14, 11, 0, 5, 1.5);    // полоса справа, слабее
  box(12, 6, 0, 2, 13, .28);      // заполняющий свет со стороны камеры
  box(18, 10, 0, -10, 3, .16);     // отражение от стола снизу
  box(5, 5, 6, 7, -9, 1.2);       // контровой сзади
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(s, .015).texture;
  pm.dispose(); return tex;
}

// opts.style: 'chrono' (по умолчанию) — хронограф со шкалой на безеле; 'dress' — трёхстрелочник с гладким безелем и фактурным циферблатом
export function buildWatch(scene, opts = {}) {
  // 'oyster' — классика с рифлёным безелем, линзой над датой и пятирядным браслетом; во всём остальном устроена как 'dress'
  const oyster = opts.style === 'oyster', dress = opts.style === 'dress' || oyster, diver = opts.style === 'diver', nh = dress || diver;
  let brand = opts.brand ?? 'AERO';
  const fine = !!opts.renderer;                              // «тонкая» отделка: студийный свет, плотный браслет, гранёные детали
  if (fine) scene.environment = studioEnv(opts.renderer);
  const gsx = dress && fine;                                 // корпус, браслет и циферблат по фото заказчика: гранёный корпус, «ойстер»-браслет, «берёза»
  /* ── текстуры ── */
  // сатинировка: тонкие штрихи в карте шероховатости
  const brushCv = makeCanvas(256);
  {
    const c = brushCv.getContext('2d');
    for (let y = 0; y < 256; y++) { const v = 120 + Math.random() * 135 | 0; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(0, y, 256, 1); }
    for (let i = 0; i < 400; i++) { const v = 90 + Math.random() * 165 | 0; c.fillStyle = `rgba(${v},${v},${v},.6)`; c.fillRect(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 90, 1); }
  }
  const brushTex = new THREE.CanvasTexture(brushCv); brushTex.wrapS = brushTex.wrapT = THREE.RepeatWrapping; brushTex.repeat.set(1, 3);

  // текущая расцветка: градиент циферблата, вставка безеля, акцент, цвет металла (сатин, полировка)
  let V = { dial: ['#2c3540', '#161b21', '#090b0e'], bezel: '#0c0e11', accent: '#ff5a1f', metal: [0xe2e5e9, 0xf4f6f8] };

  /* ── материалы ── */
  const brass    = new THREE.MeshStandardMaterial({ color: 0xb8975a, metalness: .85, roughness: .45, envMapIntensity: 1.5, side: THREE.DoubleSide });
  const rubber   = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: .85 });
  const brushed  = new THREE.MeshStandardMaterial({ color: 0xe2e5e9, metalness: 1, roughness: .5, roughnessMap: brushTex, envMapIntensity: 1.9, side: THREE.DoubleSide });
  const polished = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, metalness: 1, roughness: .1, envMapIntensity: 2.1, side: THREE.DoubleSide });
  const gold     = new THREE.MeshStandardMaterial({ color: 0xe3b862, metalness: 1, roughness: .3, envMapIntensity: 1.9, side: THREE.DoubleSide });
  const blued    = new THREE.MeshStandardMaterial({ color: 0x2a3fa0, metalness: 1, roughness: .25, envMapIntensity: 2 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: .3, envMapIntensity: 2.6, side: THREE.DoubleSide });   // гладкий безель: мягче полировки, чтобы не уходил в чёрное
  const rose     = new THREE.MeshStandardMaterial({ color: 0xcf9274, metalness: 1, roughness: .32, envMapIntensity: 1.9, side: THREE.DoubleSide });
  const ruby     = new THREE.MeshStandardMaterial({ color: 0xd01945, metalness: 0, roughness: .08, emissive: 0x52000f });
  const orange   = new THREE.MeshStandardMaterial({ color: 0xff5a1f, metalness: .2, roughness: .4 });
  const lume     = new THREE.MeshStandardMaterial({ color: 0xf2fff4, emissive: 0x8dffc0, emissiveIntensity: .3, roughness: .7 });
  const brushTexV = brushTex.clone(); brushTexV.rotation = Math.PI / 2; brushTexV.repeat.set(1, 2); brushTexV.needsUpdate = true;   // штрихи вдоль браслета
  const brushedV = new THREE.MeshStandardMaterial({ color: 0xe2e5e9, metalness: 1, roughness: .46, roughnessMap: brushTexV, envMapIntensity: 1.9, side: THREE.DoubleSide });
  const purple   = new THREE.MeshStandardMaterial({ color: 0x8b45d6, metalness: 1, roughness: .36, roughnessMap: brushTex, envMapIntensity: 1.9, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdfeaff, transparent: true, opacity: .2, roughness: 0, metalness: 0, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2 });

  const watch = new THREE.Group(); scene.add(watch);
  // слои для «взрыв-схемы»: off — на сколько слой уезжает по оси часов при разборке
  const layers = [];
  const layer = (off, base = 0, flip = false, oy = 0) => {
    const g = new THREE.Group(); g.position.z = base; if (flip) g.rotation.y = Math.PI;
    g.userData = { base, off, oy }; watch.add(g); layers.push(g); return g;
  };
  const L = { glass: layer(2.0), bezel: layer(1.45), hands: layer(.95), dial: layer(.5), body: layer(0) };
  const STRAP_OY = .9, strapTop = layer(0, 0, false, STRAP_OY), strapBot = layer(0, 0, false, -STRAP_OY);   // половинки браслета разъезжаются по вертикали
  let cur = L.body;
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = cur) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const lathe = (pts, mat) => { const m = add(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(...p)), 128), mat); m.rotation.x = Math.PI / 2; return m; };
  const cylZ = (r, h, mat, x, y, z, parent, seg = 32) => { const m = add(new THREE.CylinderGeometry(r, r, h, seg), mat, x, y, z, parent); m.rotation.x = Math.PI / 2; return m; };

  /* ── корпус ── */
  lathe([[.955, .115], [.795, .115], [.795, -.05], [.62, -.05], [.62, -.2]], brushed);    // внутренняя стенка со ступенью: корпус не «скорлупа»
  if (gsx) {
    // Корпус одним куском с ушками: контур сверху, как на фото, выдавлен с широкой плоской фаской.
    // Плоскости сатинированы, фаска зеркальная, ушки плавно уходят вниз.
    const R = .955, q = [];
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2 / 9; q.push([Math.cos(a) * R, Math.sin(a) * R]); }
    for (let i = 1; i <= 14; i++) { const t = i / 14, u = 1 - t; q.push([u * u * .7316 + 2 * u * t * .705 + t * t * .64, u * u * .6139 + 2 * u * t * .9 + t * t * 1.19]); }
    q.push([.605, 1.215]);
    for (let i = 0; i <= 8; i++) q.push([.555, 1.215 - (1.215 - .777) * i / 8]);
    const a0 = Math.atan2(.777, .555);
    for (let i = 1; i <= 10; i++) { const a = a0 + (Math.PI / 2 - a0) * i / 10; q.push([Math.cos(a) * R, Math.sin(a) * R]); }
    const rev = q.slice(0, -1).reverse(), ring = [...q, ...rev.map(([x, y]) => [-x, y]), ...q.slice(1).map(([x, y]) => [-x, -y]), ...rev.slice(0, -1).map(([x, y]) => [x, -y])];
    const s = poly(ring), hole = new THREE.Path(); hole.absarc(0, 0, .87, 0, TAU, true); s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: .19, bevelEnabled: true, bevelThickness: .05, bevelSize: .045, bevelSegments: 1, curveSegments: 64 });
    g.translate(0, 0, -.14);
    const bend = (x, y) => Math.abs(y) > .6 ? -.47 * (Math.abs(y) - .6) ** 2 * THREE.MathUtils.smoothstep(Math.abs(x), .38, .5) : 0;
    const [flat, wall, bevel] = surfaces(g, bend);
    add(flat, oyster ? polished : brushed); add(wall, oyster ? polished : brushed); add(bevel, polished);   // у «oyster» корпус целиком полированный
    lathe([[.62, -.2], [.9, -.2]], brushed);                                               // дно корпуса под крышкой
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const pin = add(new THREE.CylinderGeometry(.02, .02, .012, 16), polished, sx * .698, sy * 1.11, -.165); pin.rotation.z = Math.PI / 2; }   // винты шпилек на ушках
  } else {
  lathe([[.62, -.2], [.82, -.2], [.955, -.14], [1, -.06], [1, .05]], brushed);
  lathe([[1, .05], [.975, .1], [.955, .115]], polished);                                   // полированная фаска
  }
  cur = L.bezel;
  if (gsx && oyster) {
    // рифлёный безель: на конусе чередуются острые гребни и канавки, каждая грань плоская и ловит блик отдельно
    const N = 72, rIn = .815, rOut = .965, zIn = .225, zOut = .128, d = .03, S = 1;   // одна грань на всю длину ребра: гладкие острые рёбра, как на видео, без «насечки»
    const nx = zIn - zOut, nz = rOut - rIn, nl = Math.hypot(nx, nz);          // нормаль к образующей конуса
    const P = (a, s, h) => { const r = rIn + (rOut - rIn) * s, z = zIn + (zOut - zIn) * s, k = h * r / rOut; return [Math.cos(a) * (r + nx / nl * k), Math.sin(a) * (r + nx / nl * k), z + nz / nl * k]; };
    const pos = [];
    for (let i = 0; i < N; i++) {
      const a0 = i / N * TAU, a1 = (i + .5) / N * TAU, a2 = (i + 1) / N * TAU;
      for (let j = 0; j < S; j++) {
        const s0 = j / S, s1 = (j + 1) / S;
        for (const [aa, ha, ab, hb] of [[a0, 0, a1, d], [a1, d, a2, 0]]) {
          const p00 = P(aa, s0, ha), p10 = P(ab, s0, hb), p01 = P(aa, s1, ha), p11 = P(ab, s1, hb);
          pos.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
        }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    add(g, bezelMat);
    lathe([[.955, .1], [.972, .118], [.968, .134]], polished);                                // нижняя кромка под зубцами
    lathe([[.815, .225], [.806, .23], [.797, .214]], polished);                             // внутренний край у стекла
    lathe([[.797, .214], [.762, .118]], polished);                                         // наклонное внутреннее кольцо между стеклом и циферблатом
  } else if (gsx) {   // безель как на фото: широкое сатинированное кольцо с лёгким уклоном и узкими зеркальными кромками
    lathe([[.955, .1], [.973, .124], [.962, .15]], polished);
    lathe([[.962, .15], [.835, .202]], brushed);
    lathe([[.835, .202], [.812, .215], [.795, .2], [.795, .1]], polished);
  }
  if (!dress) add(extrude(gearShape(.968, fine ? .954 : .946, fine ? 150 : 90, .9), .085), polished, 0, 0, .115);     // рифлёный край безеля
  if (!gsx) {
  lathe(dress ? [[.957, .115], [.967, .165], [.94, .214], [.85, .234], [.8, .224]] : [[.957, .2], [.935, .224]], dress ? bezelMat : polished);   // у «dress» — гладкий полированный безель
  lathe([[.8, .224], [.795, .2], [.795, .1]], polished);                                   // внутренняя стенка
  }

  // керамическая вставка безеля со шкалой
  const bezelCv = makeCanvas(1024), bezelTex = colorTex(bezelCv);
  function drawBezel() {
    const c = bezelCv.getContext('2d'), R = 512;
    c.fillStyle = V.bezel; c.fillRect(0, 0, 1024, 1024);
    if (V.bezel2) { c.fillStyle = V.bezel2; c.fillRect(0, 512, 1024, 512); }
    c.save(); c.translate(R, R);
    for (let i = 0; i < 60; i++) {
      c.save(); c.rotate(i * TAU / 60);
      c.fillStyle = '#e9ecef';
      if (i % 5) c.fillRect(-2, -500, 4, i < 15 ? 30 : 16);
      else if (i % 10) c.fillRect(-5, -502, 10, 52);
      c.restore();
    }
    c.fillStyle = '#e9ecef'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '500 50px Unbounded, Arial, sans-serif';
    for (let i = 10; i < 60; i += 10) { c.save(); c.rotate(i * TAU / 60); c.fillText(String(i), 0, -474); c.restore(); }
    c.beginPath(); c.moveTo(-34, -504); c.lineTo(34, -504); c.lineTo(0, -446); c.closePath(); c.fill();   // треугольник на «12»
    c.fillStyle = '#b9ffd6'; c.beginPath(); c.arc(0, -484, 11, 0, TAU); c.fill();
    c.restore(); bezelTex.needsUpdate = true;
  }
  drawBezel();
  if (!dress) add(new THREE.RingGeometry(.8, .936, 128), new THREE.MeshStandardMaterial({ map: bezelTex, metalness: .15, roughness: fine ? .07 : .2, envMapIntensity: 1.4 }), 0, 0, .2245);

  /* ── циферблат ── */
  const dialCv = makeCanvas(1024), dialTex = colorTex(dialCv);
  const SUB = [[-.36, 0], [.36, 0], [0, -.36]], SUB_R = .2;      // субциферблаты на 9, 3 и 6
  // циферблат «dress»: светлая фактура из длинных неровных борозд, окно даты на «3», без счётчиков
  function drawTextured() {
    const c = dialCv.getContext('2d'), R = 512, K = 640, ink = V.ink || '#2a2d31', darkDial = /^#[c-f]/i.test(ink);
    const g = c.createRadialGradient(R, R * .8, 40, R, R, R);
    g.addColorStop(0, V.dial[0]); g.addColorStop(.7, V.dial[1]); g.addColorStop(1, V.dial[2]);
    c.globalAlpha = 1; c.fillStyle = g; c.fillRect(0, 0, 1024, 1024);
    c.lineCap = 'round';
    for (let i = 0; i < 3600; i++) {
      const x = Math.random() * 1024, y = Math.random() * 1024, len = 60 + Math.random() * 320, w = (Math.random() - .5) * 30;
      c.strokeStyle = Math.random() > .5
        ? `rgba(255,255,255,${(darkDial ? .06 : .4) + Math.random() * (darkDial ? .12 : .5)})`
        : `rgba(20,24,30,${(darkDial ? .15 : .09) + Math.random() * (darkDial ? .3 : .2)})`;
      c.lineWidth = 1.2 + Math.random() * 3.4;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w, y + len / 2, x + w * .3, y + len); c.stroke();
    }
    c.save(); c.translate(R, R);
    for (let i = 0; i < 60; i++) {
      c.save(); c.rotate(i * TAU / 60); c.fillStyle = ink; c.globalAlpha = i % 5 ? .55 : .9;
      c.fillRect(i % 5 ? -1.5 : -2.5, -500, i % 5 ? 3 : 5, i % 5 ? 20 : 30); c.restore();
    }
    c.save(); c.translate(.59 * K, 0);                            // окно даты
    c.fillStyle = '#9aa0a7'; c.beginPath(); c.roundRect(-46, -34, 92, 68, 6); c.fill();
    c.fillStyle = '#fbfbf7'; c.beginPath(); c.roundRect(-40, -28, 80, 56, 3); c.fill();
    c.fillStyle = '#16181b'; c.font = '500 38px Unbounded, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(new Date().getDate()), 0, 2);
    c.restore();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = ink;
    c.font = '500 30px Unbounded, Arial, sans-serif'; c.fillText(brand.toUpperCase(), 0, -196);
    c.font = '300 17px "JetBrains Mono", monospace'; c.globalAlpha = .75; c.fillText('A U T O M A T I C', 0, 172);
    c.restore(); c.globalAlpha = 1; dialTex.needsUpdate = true;
  }
  // циферблат «diver»: гладкий, с минутной шкалой и окном даты; надпись — логотип заказчика или пусто
  function drawDiver() {
    const c = dialCv.getContext('2d'), R = 512, K = 640;
    const g = c.createRadialGradient(R, R * .7, 30, R, R, R);
    g.addColorStop(0, V.dial[0]); g.addColorStop(.6, V.dial[1]); g.addColorStop(1, V.dial[2]);
    c.globalAlpha = 1; c.fillStyle = g; c.fillRect(0, 0, 1024, 1024);
    c.save(); c.translate(R, R);
    for (let i = 0; i < 60; i++) {
      c.save(); c.rotate(i * TAU / 60); c.fillStyle = i % 5 ? 'rgba(255,255,255,.7)' : '#fff';
      c.fillRect(i % 5 ? -1.5 : -3, -506, i % 5 ? 3 : 6, i % 5 ? 20 : 30); c.restore();
    }
    c.save(); c.translate(.6 * K, 0);
    c.fillStyle = '#c9ced4'; c.beginPath(); c.roundRect(-46, -34, 92, 68, 6); c.fill();
    c.fillStyle = '#f6f4ee'; c.beginPath(); c.roundRect(-40, -28, 80, 56, 3); c.fill();
    c.fillStyle = '#111'; c.font = '500 38px Unbounded, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(new Date().getDate()), 0, 2);
    c.restore();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#fff';
    if (brand) { c.font = '500 40px Unbounded, Arial, sans-serif'; c.fillText(brand, 0, -186); }
    c.font = '300 17px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(255,255,255,.75)'; c.fillText('A U T O M A T I C', 0, 150);
    c.fillStyle = V.accent; c.fillText('N H 3 5', 0, 178);
    c.restore(); dialTex.needsUpdate = true;
  }
  // циферблат «берёза» по фото: длинные вертикальные складки коры с рельефом и отдельное кольцо минутной шкалы
  // циферблат «oyster»: солнечные лучи от центра и мягкие разводы, как на присланном зелёном циферблате; минутная шкала по краю
  function drawOyster() {
    const c = dialCv.getContext('2d'), R = 512, K = 640, ink = V.ink || '#f2f4f2';
    let seed = 7; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    c.globalAlpha = 1;
    const g = c.createRadialGradient(R * .9, R * .8, 30, R, R, R * 1.05);
    g.addColorStop(0, V.dial[0]); g.addColorStop(.6, V.dial[1]); g.addColorStop(1, V.dial[2]);
    c.fillStyle = g; c.fillRect(0, 0, 1024, 1024);
    c.save(); c.translate(R, R);
    for (let i = 0; i < 420; i++) {                               // мраморные разводы, как на видео: мягкие светлые и тёмные пятна разного размера
      const x = (rnd() - .5) * 1000, y = (rnd() - .5) * 1000, r = 18 + rnd() * 90, light = rnd() > .55;
      const gb = c.createRadialGradient(x, y, 0, x, y, r);
      gb.addColorStop(0, light ? `rgba(160,215,180,${.05 + rnd() * .09})` : `rgba(0,0,0,${.08 + rnd() * .16})`); gb.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gb; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 90; i++) {                                // тонкие прожилки
      c.strokeStyle = `rgba(190,235,205,${.04 + rnd() * .07})`; c.lineWidth = .8 + rnd() * 1.6; c.lineCap = 'round';
      let x = (rnd() - .5) * 900, y = (rnd() - .5) * 900; c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (rnd() - .5) * 90; y += (rnd() - .5) * 90; c.lineTo(x, y); } c.stroke();
    }
    for (let i = 0; i < 600; i++) {                               // едва заметная солнечная шлифовка
      c.rotate(TAU / 600); c.strokeStyle = `rgba(255,255,255,${.004 + rnd() * .012})`; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -R); c.stroke();
    }
    for (let i = 0; i < 60; i++) {                                // минутная шкала — внутри наклонного кольца, чтобы его край её не закрывал
      c.save(); c.rotate(i * TAU / 60); c.fillStyle = ink; c.globalAlpha = i % 5 ? .6 : .95;
      c.fillRect(i % 5 ? -1.3 : -2.4, -480, i % 5 ? 2.6 : 4.8, i % 5 ? 14 : 22); c.restore();
    }
    c.globalAlpha = 1;
    c.save(); c.translate(.59 * K, 0); c.clearRect(-43, -30, 86, 60); c.restore();   // сквозное окно даты
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = ink;
    if (brand) { c.font = '600 40px "Playfair Display", Georgia, serif'; c.fillText(brand, 0, -190); }
    c.font = '500 18px Manrope, Arial, sans-serif'; c.globalAlpha = .85;
    c.fillText('A U T O M A T I C', 0, 168); c.fillText('S T A I N L E S S   S T E E L', 0, 196);
    c.restore(); c.globalAlpha = 1; dialTex.needsUpdate = true;
  }
  function drawBirch() {
    const c = dialCv.getContext('2d'), R = 512, K = 640, ink = V.ink || '#2a2d31', dark = /^#[c-f]/i.test(ink);
    let seed = 11; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;   // один и тот же рисунок при каждой перерисовке
    c.globalAlpha = 1; c.fillStyle = V.dial[1]; c.fillRect(0, 0, 1024, 1024);
    const g = c.createLinearGradient(0, 0, 1024, 1024); g.addColorStop(0, V.dial[0]); g.addColorStop(1, V.dial[2]);
    c.globalAlpha = .7; c.fillStyle = g; c.fillRect(0, 0, 1024, 1024); c.globalAlpha = 1;
    c.lineCap = c.lineJoin = 'round';
    const path = (x, y, len, wob, dx = 0) => { c.beginPath(); c.moveTo(x + dx, y); let d = 0; for (let t = 14; t < len; t += 14) { d += (rnd() - .5) * wob; x += d * .5; d *= .8; c.lineTo(x + dx, y + t); } };
    for (let i = 0; i < 110; i++) {                               // широкие мягкие волны: неровность самой поверхности
      const s0 = seed; c.lineWidth = 14 + rnd() * 40;
      c.strokeStyle = rnd() > .5 ? `rgba(255,255,255,${dark ? .035 : .3})` : `rgba(20,26,34,${dark ? .16 : .05})`;
      path(rnd() * 1024, rnd() * 1100 - 200, 200 + rnd() * 600, 16); c.stroke(); void s0;
    }
    for (let i = 0; i < 520; i++) {                               // складки: тёмная бороздка и светлая кромка рядом дают объём
      const x = rnd() * 1024, y = rnd() * 1150 - 200, len = 90 + rnd() * 460, w = 1.6 + rnd() * 3.6, s0 = seed;
      c.lineWidth = w; c.strokeStyle = dark ? `rgba(0,0,0,${.5 + rnd() * .4})` : `rgba(70,80,94,${.4 + rnd() * .45})`;
      const s1 = seed; path(x, y, len, 11); c.stroke();
      seed = s1; c.lineWidth = w * .9; c.strokeStyle = dark ? `rgba(255,255,255,${.1 + w * .04})` : 'rgba(255,255,255,.95)';
      path(x, y, len, 11, w + .6); c.stroke(); void s0;
    }
    c.save(); c.translate(R, R);
    // кольцо минутной шкалы — гладкое, отделено ступенькой
    c.beginPath(); c.arc(0, 0, 512, 0, TAU); c.arc(0, 0, 452, 0, TAU, true); c.fillStyle = V.dial[1]; c.fill();
    c.lineWidth = 5; c.strokeStyle = dark ? 'rgba(0,0,0,.7)' : 'rgba(70,78,90,.45)'; c.beginPath(); c.arc(0, 0, 451, 0, TAU); c.stroke();
    c.lineWidth = 2; c.strokeStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.95)'; c.beginPath(); c.arc(0, 0, 455, 0, TAU); c.stroke();
    for (let i = 0; i < 60; i++) {
      c.save(); c.rotate(i * TAU / 60); c.fillStyle = ink;
      if (i % 5) { c.globalAlpha = .7; c.fillRect(-1.4, -500, 2.8, 20); } else { c.globalAlpha = .95; c.fillRect(-6, -500, 12, 12); }
      c.restore();
    }
    c.save(); c.translate(.59 * K, 0);                            // окно даты (рамка — отдельная объёмная деталь)
    c.clearRect(-43, -30, 86, 60);                                // сквозное окно: число видно на настоящем диске даты под циферблатом
    c.restore();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = ink;
    c.font = '600 50px "Cormorant Garamond", Georgia, serif'; c.fillText(brand, 0, -176);
    c.font = '500 19px Manrope, Arial, sans-serif'; c.globalAlpha = .85;
    c.fillText('A U T O M A T I C', 0, 150); c.fillText('2 4   J E W E L S', 0, 180);
    c.restore(); c.globalAlpha = 1; dialTex.needsUpdate = true;
  }
  function drawDial() {
    if (gsx && oyster) return drawOyster();
    if (gsx) return drawBirch();
    if (dress) return drawTextured();
    if (diver) return drawDiver();
    const c = dialCv.getContext('2d'), R = 512, K = 640;         // K — пикселей на единицу модели
    const g = c.createRadialGradient(R, R * .75, 30, R, R, R);
    g.addColorStop(0, V.dial[0]); g.addColorStop(.65, V.dial[1]); g.addColorStop(1, V.dial[2]);
    c.fillStyle = g; c.fillRect(0, 0, 1024, 1024);
    c.save(); c.translate(R, R);
    for (let i = 0; i < 720; i++) {                              // «солнечная» шлифовка
      c.rotate(TAU / 720);
      c.strokeStyle = `rgba(255,255,255,${.008 + Math.random() * .03})`; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -R); c.stroke();
    }
    // минутная шкала с долями секунды
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 474, 0, TAU); c.stroke();
    for (let i = 0; i < 300; i++) {
      c.save(); c.rotate(i * TAU / 300);
      const min = i % 5 === 0, five = i % 25 === 0;
      c.fillStyle = five ? '#fff' : min ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.4)';
      c.fillRect(five ? -3 : -1.2, -506, five ? 6 : 2.4, five ? 32 : min ? 26 : 14);
      c.restore();
    }
    // субциферблаты
    const marks = [['60', '20', '40'], ['30', '10', '20'], ['12', '4', '8']];
    SUB.forEach(([sx, sy], n) => {
      const x = sx * K, y = -sy * K, r = SUB_R * K;
      c.save(); c.translate(x, y);
      const sg = c.createRadialGradient(0, -r * .3, 4, 0, 0, r);
      sg.addColorStop(0, '#11151a'); sg.addColorStop(1, '#050608');
      c.fillStyle = sg; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
      for (let q = 6; q < r - 26; q += 5) { c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, q, 0, TAU); c.stroke(); }  // гильоше
      const rim = c.createLinearGradient(-r, -r, r, r); rim.addColorStop(0, '#f2f4f6'); rim.addColorStop(.5, '#6e757d'); rim.addColorStop(1, '#dfe3e7');
      c.strokeStyle = rim; c.lineWidth = 5; c.beginPath(); c.arc(0, 0, r - 2, 0, TAU); c.stroke();
      for (let i = 0; i < 60; i++) {
        c.save(); c.rotate(i * TAU / 60);
        c.fillStyle = i % 5 ? 'rgba(255,255,255,.45)' : '#fff';
        c.fillRect(i % 5 ? -1 : -2, -r + 9, i % 5 ? 2 : 4, i % 5 ? 9 : 16);
        c.restore();
      }
      c.fillStyle = 'rgba(255,255,255,.9)'; c.font = '400 20px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      marks[n].forEach((m, i) => { const a = i * TAU / 3; c.fillText(m, Math.sin(a) * (r - 42), -Math.cos(a) * (r - 42)); });
      c.restore();
    });
    // окно даты между «4» и «5»
    {
      const a = TAU * 3 / 8, x = Math.sin(a) * .6 * K, y = -Math.cos(a) * .6 * K;
      c.save(); c.translate(x, y);
      c.fillStyle = '#c9ced4'; c.beginPath(); c.roundRect(-40, -30, 80, 60, 8); c.fill();
      c.fillStyle = '#f6f4ee'; c.beginPath(); c.roundRect(-35, -25, 70, 50, 5); c.fill();
      c.fillStyle = '#111'; c.font = '500 34px Unbounded, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(new Date().getDate()).padStart(2, '0'), 0, 2);
      c.restore();
    }
    // надписи
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillStyle = '#fff'; c.font = '500 50px Unbounded, Arial, sans-serif'; c.fillText(brand, 0, -200);
    c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '300 17px "JetBrains Mono", monospace'; c.fillText('A U T O M A T I C', 0, -166);
    c.fillStyle = V.accent; c.fillText('C H R O N O G R A P H', 0, -140);
    c.restore(); dialTex.needsUpdate = true;
  }
  drawDial();
  document.fonts.ready.then(() => { drawDial(); drawBezel(); drawBack(); });
  cur = L.dial;
  cylZ(.79, .04, brass, 0, 0, .088, undefined, 96);                                        // латунная основа циферблата
  for (const [x, y] of [[.5, .35], [-.5, -.35]]) cylZ(.025, .09, brass, x, y, .03);         // ножки циферблата
  add(new THREE.CircleGeometry(.8, 128), new THREE.MeshStandardMaterial({ map: dialTex, metalness: dress ? .3 : diver && fine ? .2 : .6, roughness: dress ? .5 : diver && fine ? .18 : .4, envMapIntensity: dress ? 1.4 : 1.2, bumpMap: dress ? dialTex : null, bumpScale: oyster ? 1.2 : 4, alphaTest: gsx ? .5 : 0 }), 0, 0, .11);
  if (gsx) {
    // диск даты: кольцо с числами 1–31 между циферблатом и механизмом, повёрнуто так, что в окне сегодняшнее число
    const cv = makeCanvas(1024), c = cv.getContext('2d'), K = 512 / .72, step = TAU / 31;
    c.fillStyle = '#f6f5ef'; c.fillRect(0, 0, 1024, 1024); c.translate(512, 512);
    c.strokeStyle = 'rgba(0,0,0,.14)'; c.lineWidth = 2; for (const r of [.5, .68]) { c.beginPath(); c.arc(0, 0, r * K, 0, TAU); c.stroke(); }
    c.fillStyle = '#16181b'; c.font = `600 ${.074 * K}px Manrope, Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let n = 1; n <= 31; n++) { c.save(); c.rotate((n - 1) * step); c.fillText(String(n), .59 * K, 3); c.restore(); }
    const dateLayer = layer(.26), disc = add(new THREE.RingGeometry(.46, .72, 96), new THREE.MeshStandardMaterial({ map: colorTex(cv), metalness: 0, roughness: .6 }), 0, 0, .1088, dateLayer);
    disc.rotation.z = (new Date().getDate() - 1) * step;
    disc.userData.noShadow = true;                               // диск почти вплотную под циферблатом: его тень проступала на циферблате кольцом
  }

  // накладные метки: у хронографа с люмом, у «dress» — широкие полированные, без метки на месте даты
  for (let i = 0; i < 12; i++) {
    if (nh && i === 3 && (!gsx || oyster)) continue;
    const a = i * TAU / 12, short = !nh && i && i % 3 === 0, stub = gsx && i === 3, r = short ? .7 : stub ? .683 : gsx ? .6 : dress ? .605 : .645, len = short ? .07 : stub ? .036 : gsx ? .2 : dress ? .17 : .15;
    const g = new THREE.Group(); g.position.set(Math.sin(a) * r, Math.cos(a) * r, .11); g.rotation.z = -a; cur.add(g);
    if (gsx) {                                                    // метки как на фото: парные гранёные планки, на «12» — широкая тройная
      if (oyster) { for (const bx of i === 0 ? [-.03, .03] : [0]) add(roofGeo(.019, len * .82, .03), bezelMat, bx, .012, .001, g); continue; }   // тонкие одиночные метки, на «12» — двойная
      for (const bx of i === 0 ? [-.05, 0, .05] : [-.0215, .0215]) add(roofGeo(i === 0 ? .0245 : .021, len, .032), bezelMat, bx, 0, .001, g);
      continue;
    }
    if (diver && i % 3) {                                         // у дайвера на часовых отметках круглые точки с люмом
      cylZ(.052, .03, polished, 0, 0, .016, g, 24); cylZ(.039, .006, lume, 0, 0, .033, g, 24);
      continue;
    }
    const bars = i === 0 ? (dress ? [-.044, .044] : [-.036, .036]) : [0];
    for (const bx of bars) {
      if (dress) add(extrude(poly([[-.02, -len / 2 + .013], [.02, -len / 2 + .013], [.02, len / 2 - .013], [-.02, len / 2 - .013]]), .012, .013), polished, bx, 0, .013, g);   // гранёная метка: скошенные грани ловят свет
      else add(new RoundedBoxGeometry(.052, len, .032, 2, .008), polished, bx, 0, .016, g);
      if (!dress) add(new THREE.BoxGeometry(.028, len - .035, .004), lume, bx, 0, .034, g);
    }
  }

  if (gsx) {   // объёмная полированная рамка окна даты
    const s = poly([[-.084, -.062], [.084, -.062], [.084, .062], [-.084, .062]]), h = new THREE.Path();
    h.moveTo(-.066, -.046); h.lineTo(-.066, .046); h.lineTo(.066, .046); h.lineTo(.066, -.046); h.closePath(); s.holes.push(h);
    add(extrude(s, .008, .006), polished, .59, 0, .116);
  }

  /* ── стрелки ── */
  cur = L.hands;
  const makeHand = (pts, lumeW, lumeFrom, lumeTo, z) => {
    const g = new THREE.Group(); g.position.z = z; cur.add(g);
    add(gsx ? facetHand(pts, .014) : extrude(poly(pts), dress ? .004 : .008, dress ? .006 : .003), gsx ? bezelMat : polished, 0, 0, 0, g);
    if (!dress) add(new THREE.BoxGeometry(lumeW, lumeTo - lumeFrom, .004), lume, 0, (lumeFrom + lumeTo) / 2, .013, g);
    return g;
  };
  // у «dress» стрелки гранёные «дофин» без люма, секундная — синёная
  const hHand = makeHand(dress ? [[-.012, -.08], [.012, -.08], [.052, .13], [0, .42], [-.052, .13]] : [[-.03, -.09], [.03, -.09], [.046, .3], [0, .43], [-.046, .3]], .042, .1, .29, .148);
  const mHand = makeHand(dress ? [[-.01, -.08], [.01, -.08], [.042, .17], [0, .69], [-.042, .17]] : [[-.024, -.09], [.024, -.09], [.036, .54], [0, .7], [-.036, .54]], .032, .14, .52, .166);
  // библиотека стрелок (только у «dress»): дофин, меч, лист — все лежат в модели, показывается один набор
  const handSets = [[hHand.children[0], mHand.children[0]]];
  if (nh) for (const [hp, mp] of [
    [[[-.03, -.08], [.03, -.08], [.03, .35], [0, .42], [-.03, .35]], [[-.023, -.08], [.023, -.08], [.023, .62], [0, .69], [-.023, .62]]],
    [[[-.01, -.08], [.01, -.08], [.03, .04], [.06, .2], [0, .43], [-.06, .2], [-.03, .04]], [[-.008, -.08], [.008, -.08], [.024, .1], [.048, .34], [0, .7], [-.048, .34], [-.024, .1]]],
  ]) {
    const hg = p => gsx ? facetHand(p, .014) : extrude(poly(p), .008, .003);      // в тонкой отделке и запасные стрелки гранёные: свет и тень по обе стороны ребра
    const a = add(hg(hp), gsx ? bezelMat : polished, 0, 0, 0, hHand), b = add(hg(mp), gsx ? bezelMat : polished, 0, 0, 0, mHand);
    a.visible = b.visible = false; handSets.push([a, b]);
  }
  const setHands = i => handSets.forEach((set, j) => set.forEach(m => { m.visible = j === i; }));
  const sHand = new THREE.Group(); sHand.position.z = .186; cur.add(sHand);
  const secMat = oyster ? polished : dress ? blued : orange;
  { const g = new THREE.BoxGeometry(dress ? .009 : .011, .98, .006); g.translate(0, .98 / 2 - .22, 0); add(g, secMat, 0, 0, 0, sHand); }
  cylZ(dress ? .026 : .036, .006, secMat, 0, -.16, 0, sHand);
  cylZ(.052, .05, polished, 0, 0, .168);
  cylZ(.024, .012, dress ? polished : orange, 0, 0, .198);
  // стрелки субциферблатов
  const subHands = (nh ? [] : SUB).map(([x, y]) => {
    const g = new THREE.Group(); g.position.set(x, y, .118); cur.add(g);
    add(extrude(poly([[-.012, -.03], [.012, -.03], [.005, .15], [-.005, .15]]), .004), polished, 0, 0, 0, g);
    cylZ(.02, .008, polished, 0, 0, .004, g);
    return g;
  });

  // сапфировое стекло
  cylZ(.794, .05, glassMat, 0, 0, .236, L.glass, 96);                                      // толстое «коробчатое» стекло
  add(new THREE.TorusGeometry(.782, .013, 8, 96), rubber, 0, 0, .209, L.glass);
  if (fine) {   // выпуклое стекло с бликом софтбокса и линза над датой — главные признаки «настоящих» часов на фото
    const R = 8, cap = add(new THREE.SphereGeometry(R, 64, 10, 0, TAU, 0, Math.asin(.79 / R)), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: gsx ? .32 : .03, transparent: true, opacity: gsx ? .07 : .2, /* в тонкой отделке блик размыт: чёткий край софтбокса читался как кольцо на циферблате */ blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 1.5 }), 0, 0, .276 - R, L.glass);
    cap.rotation.x = Math.PI / 2; cap.userData.noShadow = true;
    if (diver || oyster) { const lens = add(new THREE.SphereGeometry(oyster ? .118 : .105, 32, 16), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: .22, roughness: 0, metalness: 0, clearcoat: 1, envMapIntensity: 2.4 }), .6, 0, .262, L.glass); lens.scale.set(1, .78, .22); lens.userData.noShadow = true;
      if (oyster) {
        // увеличение под линзой: поверх окна даты лежит то же число, только крупнее, — так линза на фото и выглядит
        const cv = makeCanvas(256), c = cv.getContext('2d');
        c.fillStyle = '#f7f6f1'; c.beginPath(); c.ellipse(128, 128, 126, 98, 0, 0, TAU); c.fill();
        c.fillStyle = '#121416'; c.font = '600 128px Manrope, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(new Date().getDate()), 128, 136);
        const mag = add(new THREE.CircleGeometry(.112, 48), new THREE.MeshBasicMaterial({ map: colorTex(cv), transparent: true, toneMapped: false, depthWrite: false }), .59, 0, .232, L.glass);
        mag.scale.y = .78; mag.userData.noShadow = true; mag.material.color.setScalar(.92);
        document.fonts.ready.then(() => { c.clearRect(0, 0, 256, 256); c.fillStyle = '#f7f6f1'; c.beginPath(); c.ellipse(128, 128, 126, 98, 0, 0, TAU); c.fill(); c.fillStyle = '#121416'; c.fillText(String(new Date().getDate()), 128, 136); mag.material.map.needsUpdate = true; });
        lens.material.opacity = .32;
      }
    }
  }            // уплотнитель
  cylZ(.018, .15, polished, 0, 0, .1, L.hands, 16);                                        // ось стрелок

  /* ── головка, защита головки, кнопки хронографа ── */
  cur = L.body;
  const crown = add(extrude(gearShape(fine ? .1 : .105, .092, fine ? 40 : 22), .13), polished, 1.035, 0, -.03); crown.rotation.y = Math.PI / 2;
  if (gsx) crown.scale.set(1.28, 1.28, 1);                     // на настоящих часах головка крупная
  { const m = add(new THREE.CylinderGeometry(.06, .06, .06, 24), brushed, 1.01, 0, -.03); m.rotation.z = Math.PI / 2; }
  { const m = add(new THREE.CylinderGeometry(.09, .078, .025, 24), polished, 1.178, 0, -.03); m.rotation.z = -Math.PI / 2; }
  { const m = add(new THREE.CylinderGeometry(.03, .03, .01, 16), dress ? polished : orange, 1.193, 0, -.03); m.rotation.z = Math.PI / 2; }
  for (const s of dress ? [] : [-1, 1]) {                                                            // у «dress» нет кнопок хронографа
    add(new RoundedBoxGeometry(.1, .1, .15, 2, .03), brushed, .985, s * .165, -.03); if (diver) continue;                   // защита головки
    const p = new THREE.Group(); p.rotation.z = s * .6; p.position.z = -.03; cur.add(p);                // кнопка
    let m = add(new THREE.CylinderGeometry(.078, .078, .06, 24), brushed, 1.0, 0, 0, p); m.rotation.z = Math.PI / 2;
    m = add(new THREE.CylinderGeometry(.06, .06, .11, 24), polished, 1.075, 0, 0, p); m.rotation.z = Math.PI / 2;
  }

  /* ── ушки ── */
  if (!gsx) {
    const s = new THREE.Shape();
    if (fine) {   // тонкие ушки: ниже, с плавным изгибом и широкой фаской, а не выступающие бруски
      s.moveTo(.7, .05); s.lineTo(.9, .05); s.quadraticCurveTo(1.15, .028, 1.245, -.15);
      s.lineTo(1.245, -.2); s.quadraticCurveTo(1.22, -.235, 1.12, -.225); s.lineTo(.7, -.2);
    } else {
    s.moveTo(.7, .1); s.lineTo(.96, .1); s.quadraticCurveTo(1.2, .07, 1.27, -.13);
    s.lineTo(1.27, -.19); s.quadraticCurveTo(1.25, -.235, 1.15, -.22); s.lineTo(.7, -.2);
    }
    s.closePath();
    const g = extrude(s, fine ? .12 : .2, fine ? .042 : .02); g.translate(0, 0, fine ? -.06 : -.1);
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));           // профиль (y,z), выдавливание по x
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const l = add(g, brushed, sx * .55, 0, 0); l.scale.y = sy;
      const pin = add(new THREE.CylinderGeometry(.028, .028, .012, 16), polished, sx * .672, sy * 1.14, -.12); pin.rotation.z = Math.PI / 2;  // винт шпильки
    }
  }

  /* ── браслет: пятирядные звенья вдоль эллипса ── */
  {
    const A = 1.75, B = 1.2, Z0 = gsx ? .17 : .1, phi0 = Math.asin((gsx ? 1.25 : 1.0) / A), phi1 = TAU - phi0, N = 2000;
    const pt = p => [A * Math.sin(p), Z0 - B + B * Math.cos(p)];
    const cum = [0]; let prev = pt(phi0);
    for (let i = 1; i <= N; i++) { const q = pt(phi0 + (phi1 - phi0) * i / N); cum.push(cum[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1])); prev = q; }
    const L = cum[N], rows = Math.round(L / (fine && !gsx ? .2 : .27)), pitch = L / rows, len = pitch - (fine ? .005 : .022);
    // звено «ойстер»: зеркальные бока с тонкой фаской и сатинированная вдоль браслета верхняя плоскость
    const link = (w, h, parent, x, z = 0, l = pitch - .014, edge = .03) => {   // edge — ширина зеркальной кромки вокруг сатинированной плоскости
      add(new RoundedBoxGeometry(w, l, h, 2, .013), polished, x, 0, z, parent);
      add(new THREE.BoxGeometry(w - edge, l - .03, .004), brushedV, x, 0, z + h / 2, parent);
      add(new THREE.BoxGeometry(w - .03, l - .03, .004), brushedV, x, 0, z - h / 2, parent);   // изнанка звена тоже сатинирована
    };
    const rowAt = target => {
      let i = 0; while (i < N && cum[i] < target) i++;
      const p = phi0 + (phi1 - phi0) * i / N, [y, z] = pt(p), row = new THREE.Group();
      row.position.set(0, y, z); row.rotation.x = Math.atan2(-B * Math.sin(p), A * Math.cos(p));
      row.scale.x = 1 - .14 * Math.sin(Math.PI * target / L);
      (y >= 0 ? strapTop : strapBot).add(row); return row;
    };
    if (gsx) {
      if (oyster) {
        // пятирядный браслет: широкие крайние звенья и три ряда мелких полированных «таблеток» посередине, средний ряд сдвинут на полшага
        // звенья стоят вплотную: мелкие средние касаются крайних и друг друга, по длине — без просветов,
        // а снизу их держит сплошная стальная лента, поэтому браслет не распадается на «парящие» детали
        const pill = new RoundedBoxGeometry(.132, pitch * 1.02, .088, 5, .04);
        const outer = new RoundedBoxGeometry(.3, pitch * 1.01, .11, 6, .05);
        const core = new THREE.BoxGeometry(.96, pitch * 1.06, .05);
        const coreMat = new THREE.MeshStandardMaterial({ color: 0x8f949b, metalness: 1, roughness: .45, envMapIntensity: 1.2 });
        for (let k = 0; k < rows; k++) {
          const row = rowAt((k + .5) * pitch);
          add(core, coreMat, 0, 0, -.025, row);
          for (const s of [-1, 1]) { add(outer, bezelMat, s * .35, 0, 0, row); add(pill, polished, s * .133, 0, .004, row); }   // крайние звенья выпуклые и блестящие
        }
        for (let k = 1; k < rows; k++) add(pill, polished, 0, 0, .006, rowAt(k * pitch));
      } else {
      for (let k = 0; k < rows; k++) { const row = rowAt((k + .5) * pitch); for (const s of [-1, 1]) link(.305, .1, row, s * .3475); }
      for (let k = 1; k < rows; k++) link(.38, .104, rowAt(k * pitch), 0, .004, pitch - .014, .1);         // центральные звенья со сдвигом на полшага, «кирпичной» кладкой
      }
      for (const s of [-1, 1]) {                                                           // концевые звенья, вписанные между ушками
        const e = new THREE.Group(); e.position.set(0, s * 1.1, -.108); e.rotation.x = -s * .44; (s > 0 ? strapTop : strapBot).add(e);
        if (oyster) {   // концевое звено продолжает рисунок браслета: выпуклые крайние и три мелких полированных посередине
          add(new THREE.BoxGeometry(.96, .33, .07), new THREE.MeshStandardMaterial({ color: 0x8f949b, metalness: 1, roughness: .45, envMapIntensity: 1.2 }), 0, 0, -.03, e);   // основа концевого звена
          for (const t of [-1, 1]) add(new RoundedBoxGeometry(.3, .33, .14, 6, .06), bezelMat, t * .35, 0, 0, e);
          for (const x of [-.133, 0, .133]) add(new RoundedBoxGeometry(.132, .33, .12, 5, .045), polished, x, 0, .006, e);
        } else { link(.38, .14, e, 0, .004, .33, .1); for (const t of [-1, 1]) link(.31, .136, e, t * .35, 0, .33); }
      }
      const zc = Z0 - 2 * B;                                                               // раскладная застёжка: длинная сатинированная пластина и флажок замка
      const c = new THREE.Group(); c.position.z = zc - .075; c.rotation.x = Math.PI; strapBot.add(c);
      link(.9, .05, c, 0, 0, 1.08);
      add(new RoundedBoxGeometry(.9, .2, .03, 2, .012), polished, 0, .46, .03, c);
      add(new RoundedBoxGeometry(.34, .1, .02, 2, .008), brushedV, 0, .46, .05, c);
    }
    const gMid = new RoundedBoxGeometry(.25, len, .11, 3, .035), gIn = new RoundedBoxGeometry(.09, len * .82, .1, 3, .03), gOut = new RoundedBoxGeometry(.17, len, .115, 3, .035);
    const g3Mid = fine ? new RoundedBoxGeometry(.33, len, .1, 5, .048) : new RoundedBoxGeometry(.33, len, .115, 3, .035), g3Out = fine ? new RoundedBoxGeometry(.235, len, .094, 5, .045) : new RoundedBoxGeometry(.235, len, .11, 3, .035);   // у тонкой отделки звенья мельче и скруглённые
    let j = 0;
    for (let k = 0; k < (gsx ? 0 : rows); k++) {
      const target = (k + .5) * pitch; while (cum[j] < target) j++;
      const p = phi0 + (phi1 - phi0) * j / N, [y, z] = pt(p);
      const row = new THREE.Group(); row.position.set(0, y, z);
      row.rotation.x = Math.atan2(-B * Math.sin(p), A * Math.cos(p));
      row.scale.x = 1 - .15 * Math.sin(Math.PI * k / (rows - 1));                                       // сужение к застёжке
      if (nh) {                                                                                      // трёхрядный браслет
        add(g3Mid, brushed, 0, 0, 0, row);
        for (const s of [-1, 1]) add(g3Out, brushed, s * .292, 0, 0, row);
      } else {
        add(gMid, brushed, 0, 0, 0, row);
        for (const s of [-1, 1]) { add(gIn, polished, s * .178, 0, 0, row); add(gOut, brushed, s * .316, 0, 0, row); }
      }
      (y >= 0 ? strapTop : strapBot).add(row);
    }
    // концевые звенья между ушками
    if (!gsx) {
    for (const s of [-1, 1]) { const e = add(new RoundedBoxGeometry(.84, .24, .15, 3, .04), brushed, 0, s * .93, -.075, s > 0 ? strapTop : strapBot); e.rotation.x = -s * .22; }
    cur = strapBot;
    // застёжка
    const zc = Z0 - 2 * B;
    add(new RoundedBoxGeometry(.7, .8, .05, 3, .02), brushed, 0, 0, zc - .08);
    add(new RoundedBoxGeometry(.3, .22, .05, 3, .02), polished, 0, 0, zc - .115);
    for (const s of [-1, 1]) add(new RoundedBoxGeometry(.04, .16, .05, 2, .015), polished, s * .365, 0, zc - .07);
    }
  }

  /* ── задняя крышка с видимым механизмом ── */
  const back = layer(-2.3, -.16, true), cover = layer(-3.1, -.16, true);
  cylZ(.6, .12, nh ? brushed : brass, 0, 0, -.062, back, 64);   // тело механизма: у «dress» стальное, как у NH35
  cylZ(.615, .03, polished, 0, 0, -.02, back, 64);             // стальное кольцо-держатель
  add(extrude(gearShape(.825, .825, 48, .6), .03), brushed, 0, 0, .026, cover);   // толщина задней крышки
  back.userData.spin = true;                                  // при разборке механизм разворачивается лицом к зрителю
  // этажи механизма: при разборке колёса, баланс, мосты и ротор поднимаются над платиной каждый на свою высоту
  const mvParts = [], mvLift = (g, off) => { mvParts.push({ g, base: g.position.z, off }); return g; };
  const mvGroup = off => { const g = new THREE.Group(); back.add(g); return mvLift(g, off); };
  const mvTrain = mvGroup(.13), mvBridge = mvGroup(.27);
  // платина с женевскими полосами
  const plateCv = makeCanvas(1024), plateTex = colorTex(plateCv);
  {
    const c = plateCv.getContext('2d');
    c.fillStyle = nh ? '#a4a9b0' : '#b8bcc2'; c.fillRect(0, 0, 1024, 1024);
    if (nh) {
      // «рабочая» отделка, как у NH35: серая сталь с перлажем — рядами мелких круговых шлифовок
      for (let y = 0, r = 0; y < 1060; y += 34, r++) for (let x = (r % 2) * 20; x < 1060; x += 40) {
        const g = c.createRadialGradient(x - 6, y - 6, 1, x, y, 24);
        g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(.55, 'rgba(160,166,174,.25)'); g.addColorStop(1, 'rgba(60,66,74,.4)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, 24, 0, TAU); c.fill();
      }
    } else {
      c.save(); c.translate(512, 512); c.rotate(-.5);
      for (let x = -800; x < 800; x += 84) {
        const g = c.createLinearGradient(x, 0, x + 84, 0);
        g.addColorStop(0, '#888d95'); g.addColorStop(.5, '#eef0f2'); g.addColorStop(1, '#8f949b');
        c.fillStyle = g; c.fillRect(x, -800, 84, 1600);
      }
      c.restore();
    }
    c.strokeStyle = 'rgba(30,34,40,.75)'; c.lineWidth = 7; c.lineCap = 'round';                         // контуры мостов
    c.beginPath(); c.moveTo(60, 430); c.bezierCurveTo(300, 380, 420, 620, 980, 520); c.stroke();
    c.beginPath(); c.moveTo(520, 40); c.bezierCurveTo(470, 300, 640, 420, 600, 990); c.stroke();
    c.beginPath(); c.arc(730, 730, 190, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(20,24,30,.55)'; c.beginPath(); c.arc(730, 730, 186, 0, TAU); c.fill();           // колодец баланса
  }
  cylZ(.6, .01, new THREE.MeshStandardMaterial({ map: plateTex, metalness: 1, roughness: .38, envMapIntensity: 1.6 }), 0, 0, 0, back, 64).rotation.x = Math.PI / 2;
  add(new THREE.CircleGeometry(.6, 96), new THREE.MeshStandardMaterial({ map: plateTex, metalness: 1, roughness: .38, envMapIntensity: 1.6 }), 0, 0, .006, back);
  // колёса
  const gears = [[-.22, .2, .15, 28, 1], [.02, .33, .1, 18, -1.55], [-.33, -.06, .085, 16, -1.75]].map(([x, y, r, teeth, speed]) => {
    const m = add(extrude(gearShape(r, r * .88, teeth, r * .22), .008), gold, x, y, .01, mvTrain);
    m.userData.speed = speed; return m;
  });
  // баланс
  const balance = new THREE.Group(); balance.position.set(.255, -.255, .014); back.add(balance); mvLift(balance, .2);
  add(new THREE.TorusGeometry(.125, .013, 10, 48), gold, 0, 0, 0, balance);
  add(new THREE.BoxGeometry(.25, .016, .008), gold, 0, 0, 0, balance);
  add(new THREE.BoxGeometry(.016, .25, .008), gold, 0, 0, 0, balance);
  add(new THREE.TorusGeometry(.05, .004, 6, 32), blued, 0, 0, .008, balance);                           // спираль
  cylZ(.018, .012, ruby, .255, -.255, .026, back, 16);
  // камни в шатонах и синёные винты
  for (const [x, y] of [[-.22, .2], [.02, .33], [-.33, -.06], [.3, .2], [-.05, -.38]]) {
    cylZ(.036, .01, gold, x, y, .02, back, 20); cylZ(.022, .012, ruby, x, y, .021, back, 16);
  }
  for (const [x, y] of [[.42, -.02], [-.44, .26], [.14, -.46], [-.36, -.36], [.36, .4]]) {
    cylZ(.03, .012, blued, x, y, .014, back, 16);
    add(new THREE.BoxGeometry(.05, .007, .004), new THREE.MeshStandardMaterial({ color: 0x0a0e24, metalness: 1, roughness: .4 }), x, y, .021, back).rotation.z = x * 7;
  }
  if (gsx) {   // объёмные мосты поверх платины: мост баланса и мост барабана, как у NH35
    add(extrude(poly([[.5, -.02], [.565, -.13], [.31, -.31], [.225, -.3], [.215, -.215], [.42, -.07]]), .006, .003), polished, 0, 0, .017, mvBridge);
    add(extrude(poly([[-.52, -.18], [-.3, -.27], [-.1, -.5], [-.3, -.5], [-.5, -.33]]), .007, .003), brushed, 0, 0, .009, mvBridge);
    add(extrude(poly([[.1, .56], [.34, .46], [.52, .22], [.4, .16], [.26, .34], [.08, .44]]), .007, .003), brushed, 0, 0, .009, mvBridge);
  }
  // ротор автоподзавода
  const rotor = new THREE.Group(); rotor.position.z = .03; back.add(rotor); mvLift(rotor, .42);
  let rotorSeg;
  const steelRotor = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: .34, roughnessMap: brushTex, envMapIntensity: 1.9, side: THREE.DoubleSide });
  // золотой ротор с «веером» лучей, как на фото: рельеф из расходящихся от оси граней
  const fanCv = makeCanvas(512);
  { const c = fanCv.getContext('2d'); c.translate(256, 256); c.fillStyle = '#fff'; c.fillRect(-256, -256, 512, 512); for (let i = 0; i < 48; i++) { c.rotate(TAU / 48); c.fillStyle = i % 2 ? '#ffffff' : '#a8a8a8'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 380, 0, TAU / 48); c.closePath(); c.fill(); } }
  const fanTex = new THREE.CanvasTexture(fanCv); fanTex.wrapS = fanTex.wrapT = THREE.RepeatWrapping; fanTex.repeat.set(.85, .85); fanTex.offset.set(.5, .5);
  const goldFan = new THREE.MeshStandardMaterial({ color: 0xe6c458, metalness: 1, roughness: .36, bumpMap: fanTex, bumpScale: 2, envMapIntensity: 1.9, side: THREE.DoubleSide });
  let rotorWeb;
  const rotorMats = gsx ? [rose, steelRotor, purple, goldFan] : [rose, steelRotor, gold, blued];             // библиотека роторов (у «берёзы» — три ротора с фото)
  const setRotor = i => { rotorSeg.material = rotorMats[i] || rotorMats[0]; if (gsx) rotorWeb.material = rotorSeg.material; };
  {
    const s = new THREE.Shape();
    s.moveTo(.56, 0); s.absarc(0, 0, .56, 0, Math.PI, false); s.lineTo(-.44, 0); s.absarc(0, 0, .44, Math.PI, 0, true); s.closePath();
    rotorSeg = add(extrude(s, .022, .004), dress ? rose : diver ? steelRotor : gold, 0, 0, 0, rotor);                        // тяжёлый сегмент
    if (gsx) {
      // гравированный ротор, как на фото настоящих часов: надпись по ободу и чешуйчатый орнамент на полотне
      const engrave = (outerR, z, innerR) => {
        const cv = makeCanvas(1024), c = cv.getContext('2d'), K = 512 / outerR;
        c.translate(512, 512); c.strokeStyle = c.fillStyle = 'rgba(46,26,14,.62)'; c.lineCap = 'round';
        for (const [r, w] of [[.548, 2.5], [.452, 2.5], [.428, 2], [.128, 2.5]]) { c.lineWidth = w; c.beginPath(); c.arc(0, 0, r * K, Math.PI, TAU); c.stroke(); }
        c.font = `600 ${.062 * K}px Manrope, Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        const txt = 'MECHANICAL  MOVEMENT'; arcText(c, txt, 0, 0, .5 * K, -1.12, 2.24 / (txt.length - 1));
        c.lineWidth = 2.2;
        for (let r = .17, row = 0; r < .42; r += .042, row++) {                                 // чешуя рядами со сдвигом
          const n = Math.round(Math.PI * r / .062), da = Math.PI / n;
          for (let i = 0; i < n; i++) {
            const a = Math.PI + (i + .5) * da, x = Math.cos(a) * r * K, y = Math.sin(a) * r * K;
            if (row % 2 && (i === 0 || i === n - 1)) continue;
            c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2 + (row % 2 ? da / 2 : 0));
            c.beginPath(); c.arc(0, 0, .027 * K, 0, Math.PI); c.stroke();
            c.beginPath(); c.arc(0, 0, .012 * K, 0, Math.PI); c.stroke(); c.restore();
          }
        }
        const m = add(new THREE.RingGeometry(innerR, outerR, 96, 1, 0, Math.PI), new THREE.MeshStandardMaterial({ map: colorTex(cv), transparent: true, metalness: .5, roughness: .55, depthWrite: false }), 0, 0, z, rotor);
        m.userData.noShadow = true;
      };
      document.fonts.ready.then(() => { engrave(.555, .0275, .445); engrave(.435, .0135, .1); });
    } else if (nh) {
      // гравировка по дуге ротора, как на заводском роторе этого механизма
      const cv = makeCanvas(1024), c = cv.getContext('2d'), tex = colorTex(cv);
      c.clearRect(0, 0, 1024, 1024); c.fillStyle = 'rgba(30,34,40,.85)'; c.font = '500 30px Unbounded, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const txt = 'NH35A · TWENTY-FOUR JEWELS · JAPAN';
      arcText(c, txt, 512, 512, 512 * .345 / .43, -1.05, 2.1 / (txt.length - 1));
      const ring = add(new THREE.RingGeometry(.11, .43, 96, 1, 0, Math.PI), new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: .6, roughness: .5 }), 0, 0, .0135, rotor);
      ring.userData.noShadow = true;
    }
    const web = new THREE.Shape();
    web.moveTo(.44, 0); web.absarc(0, 0, .44, 0, Math.PI, false); web.lineTo(-.09, 0); web.absarc(0, 0, .09, Math.PI, 0, true); web.closePath();
    for (const a of gsx ? [] : [.55, Math.PI / 2, Math.PI - .55]) { const h = new THREE.Path(); h.absarc(Math.cos(a) * .27, Math.sin(a) * .27, .085, 0, TAU, true); web.holes.push(h); }
    rotorWeb = add(extrude(web, .008), gsx ? rose : brushed, 0, 0, .004, rotor);                  // ажурная перемычка
    cylZ(.09, .014, polished, 0, 0, .012, rotor, 32);
    cylZ(.03, .02, blued, 0, 0, .014, rotor, 16);
  }
  // стекло и гравированное кольцо крышки
  add(new THREE.CircleGeometry(.6, 96), glassMat, 0, 0, .054, cover);
  // глухая стальная крышка вместо стекла — по выбору (механизм скрыт)
  const solidBack = cylZ(.6, .014, brushed, 0, 0, .047, cover, 64); solidBack.visible = false;
  const setCaseback = solid => { solidBack.visible = !!solid; };
  const setLogo = text => { brand = text || ''; drawDial(); };
  const backCv = makeCanvas(1024), backTex = colorTex(backCv);
  function drawBack() {
    const c = backCv.getContext('2d'), R = 512;
    c.fillStyle = '#d3d6da'; c.fillRect(0, 0, 1024, 1024);
    // редкие мягкие круговые штрихи: частые тонкие линии рябили при движении
    for (let r = 300; r < 520; r += 5) { const v = Math.random() > .5 ? 255 : 120; c.strokeStyle = `rgba(${v},${v},${v},.07)`; c.lineWidth = 3; c.beginPath(); c.arc(R, R, r, 0, TAU); c.stroke(); }
    c.fillStyle = '#3a3f46'; c.font = '400 30px Unbounded, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const text = opts.backText || 'AERO—41  ·  STAINLESS STEEL 316L  ·  SAPPHIRE CRYSTAL  ·  10 ATM  ·  № 041/500  ·  ';
    arcText(c, text, R, R, 443, 0, TAU / text.length);
    backTex.needsUpdate = true;
  }
  drawBack();
  add(new THREE.RingGeometry(.6, .825, 128), new THREE.MeshStandardMaterial({ map: backTex, metalness: 1, roughness: .38, envMapIntensity: 1.5 }), 0, 0, .0595, cover);   // чуть выше торца крышки, иначе две поверхности «дерутся» и мерцают
  if (gsx) for (let i = 0; i < 6; i++) {   // шлицы под ключ на крышке — прямоугольные, как на фото
    const a = i * TAU / 6 + .26, n = add(new THREE.BoxGeometry(.11, .045, .012), new THREE.MeshStandardMaterial({ color: 0x3c4046, metalness: 1, roughness: .45 }), Math.cos(a) * .775, Math.sin(a) * .775, .0575, cover);
    n.rotation.z = a + Math.PI / 2;
  }
  else for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + .26; cylZ(.022, .01, new THREE.MeshStandardMaterial({ color: 0x555a61, metalness: 1, roughness: .4 }), Math.cos(a) * .79, Math.sin(a) * .79, .062, cover, 6); }

  // детали отбрасывают тени друг на друга (кроме стёкол)
  watch.traverse(o => { if (o.isMesh && o.material !== glassMat && !o.userData.noShadow) o.castShadow = o.receiveShadow = true; });

  /* ── мягкая тень под часами ── */
  const shCv = makeCanvas(256);
  { const c = shCv.getContext('2d'), g = c.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(.5, 'rgba(0,0,0,.16)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 256, 256); }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shCv), transparent: true, depthWrite: false, toneMapped: false }));
  shadow.renderOrder = -1; scene.add(shadow);

  // детали для подписей: r — радиус точки привязки, z — исходная глубина слоя
  const parts = [
    { name: 'Стекло',         mat: 'сапфир, двойной антиблик',         r: .8,  z: .214, off: 2.0 },
    { name: 'Безель',         mat: 'сталь 316L, керамическая вставка', r: .96, z: .17,  off: 1.45 },
    { name: 'Стрелки',        mat: 'полированная сталь, люминофор',    r: .45, z: .17,  off: .95 },
    { name: 'Циферблат',      mat: 'латунь, солнечная шлифовка',       r: .8,  z: .11,  off: .5 },
    { name: 'Корпус',         mat: 'сталь 316L, сатинировка',          r: 1,   z: 0,    off: 0 },
    { name: 'Механизм',       mat: 'калибр A41, 25 камней',            r: .75, z: -.16, off: -2.3 },
    { name: 'Задняя крышка',  mat: 'сталь и сапфировое стекло',        r: .82, z: -.21, off: -3.1 },
    { name: 'Браслет',        mat: 'сталь 316L, пять рядов звеньев',   r: 1.75, z: -1.1, off: 0, oy: STRAP_OY },
  ];
  (opts.partMats || []).forEach((m, i) => { if (m && parts[i]) parts[i].mat = m; });   // свои подписи материалов для конкретных часов
  let ex = 0, faceFront = 1;                                     // ex: 0 — собраны, 1 — разобраны; faceFront: 1 — часы повёрнуты циферблатом к зрителю
  const anchor = (i, side, v) => { const p = parts[i]; v.set(0, side * (p.r + (p.oy || 0) * ex), p.z + p.off * ex); return watch.localToWorld(v); };

  function update(t, exploded = false) {
    ex += ((exploded ? 1 : 0) - ex) * .07;
    for (const g of layers) { g.position.z = g.userData.base + g.userData.off * ex; g.position.y = g.userData.oy * ex; }
    // механизм разворачивается ротором к зрителю, только пока часы смотрят на него циферблатом;
    // если их повернули спиной, ротор и так виден сзади — разворот убираем
    faceFront += ((watch.matrixWorld.elements[10] > 0 ? 1 : 0) - faceFront) * .08;
    const turn = ex * ex * (3 - 2 * ex) * faceFront * faceFront * (3 - 2 * faceFront);
    back.rotation.y = Math.PI * (1 - turn); back.scale.setScalar(1 + .25 * turn);
    for (const p of mvParts) p.g.position.z = p.base + p.off * ex;
    const d = new Date(), s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = d.getHours() % 12 + m / 60;
    sHand.rotation.z = -s / 60 * TAU; mHand.rotation.z = -m / 60 * TAU; hHand.rotation.z = -h / 12 * TAU;
    if (subHands.length) {
      subHands[0].rotation.z = -Math.floor(t * 2) / 2 / 60 * TAU * 6;   // бегущая секундная, шагами как у механики
      subHands[1].rotation.z = -m / 30 * TAU;
      subHands[2].rotation.z = -h / 12 * TAU;
    }
    rotor.rotation.z = t * .45 + Math.sin(t * .8) * .9;
    balance.rotation.z = Math.sin(t * 14) * 1.1;
    for (const g of gears) g.rotation.z = t * .25 * g.userData.speed;
    const sc = watch.scale.x;
    shadow.position.set(watch.position.x + .25 * sc, watch.position.y - 2.35 * sc, -2);
    shadow.scale.set(4.2 * sc, .7 * sc, 1);
    shadow.material.opacity = THREE.MathUtils.clamp(1.6 - sc * .7, 0, .8);
    return ex;
  }
  // смена расцветки: перерисовать циферблат и безель, перекрасить металл и акцент
  function setVariant(v) {
    V = v; drawDial(); drawBezel();
    orange.color.set(v.accent); brushed.color.set(v.metal[0]); brushedV.color.set(v.metal[0]); polished.color.set(v.metal[1]); bezelMat.color.set(v.metal[1]);
  }
  return { watch, update, parts, anchor, setVariant, setHands, setRotor, setCaseback, setLogo };
}
