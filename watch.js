// Процедурная модель часов AERO—41: всё собрано кодом, без внешних 3D-файлов.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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

// opts.style: 'chrono' (по умолчанию) — хронограф со шкалой на безеле; 'dress' — трёхстрелочник с гладким безелем и фактурным циферблатом
export function buildWatch(scene, opts = {}) {
  const dress = opts.style === 'dress', brand = opts.brand || 'AERO';
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
  lathe([[.62, -.2], [.82, -.2], [.955, -.14], [1, -.06], [1, .05]], brushed);
  lathe([[1, .05], [.975, .1], [.955, .115]], polished);                                   // полированная фаска
  cur = L.bezel;
  if (!dress) add(extrude(gearShape(.968, .946, 90, .9), .085), polished, 0, 0, .115);     // рифлёный край безеля
  lathe(dress ? [[.957, .115], [.967, .165], [.94, .214], [.85, .234], [.8, .224]] : [[.957, .2], [.935, .224]], dress ? bezelMat : polished);   // у «dress» — гладкий полированный безель
  lathe([[.8, .224], [.795, .2], [.795, .1]], polished);                                   // внутренняя стенка

  // керамическая вставка безеля со шкалой
  const bezelCv = makeCanvas(1024), bezelTex = colorTex(bezelCv);
  function drawBezel() {
    const c = bezelCv.getContext('2d'), R = 512;
    c.fillStyle = V.bezel; c.fillRect(0, 0, 1024, 1024);
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
  if (!dress) add(new THREE.RingGeometry(.8, .936, 128), new THREE.MeshStandardMaterial({ map: bezelTex, metalness: .15, roughness: .2, envMapIntensity: 1.4 }), 0, 0, .2245);

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
  function drawDial() {
    if (dress) return drawTextured();
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
  add(new THREE.CircleGeometry(.8, 128), new THREE.MeshStandardMaterial({ map: dialTex, metalness: dress ? .2 : .6, roughness: dress ? .6 : .4, envMapIntensity: dress ? .8 : 1.2 }), 0, 0, .11);

  // накладные метки: у хронографа с люмом, у «dress» — широкие полированные, без метки на месте даты
  for (let i = 0; i < 12; i++) {
    if (dress && i === 3) continue;
    const a = i * TAU / 12, short = !dress && i && i % 3 === 0, r = short ? .7 : dress ? .605 : .645, len = short ? .07 : dress ? .17 : .15;
    const g = new THREE.Group(); g.position.set(Math.sin(a) * r, Math.cos(a) * r, .11); g.rotation.z = -a; cur.add(g);
    const bars = i === 0 ? (dress ? [-.044, .044] : [-.036, .036]) : [0];
    for (const bx of bars) {
      add(new RoundedBoxGeometry(dress ? .066 : .052, len, dress ? .04 : .032, 2, .008), polished, bx, 0, dress ? .02 : .016, g);
      if (!dress) add(new THREE.BoxGeometry(.028, len - .035, .004), lume, bx, 0, .034, g);
    }
  }

  /* ── стрелки ── */
  cur = L.hands;
  const makeHand = (pts, lumeW, lumeFrom, lumeTo, z) => {
    const g = new THREE.Group(); g.position.z = z; cur.add(g);
    add(extrude(poly(pts), .008, .003), polished, 0, 0, 0, g);
    if (!dress) add(new THREE.BoxGeometry(lumeW, lumeTo - lumeFrom, .004), lume, 0, (lumeFrom + lumeTo) / 2, .013, g);
    return g;
  };
  // у «dress» стрелки гранёные «дофин» без люма, секундная — синёная
  const hHand = makeHand(dress ? [[-.012, -.08], [.012, -.08], [.052, .13], [0, .42], [-.052, .13]] : [[-.03, -.09], [.03, -.09], [.046, .3], [0, .43], [-.046, .3]], .042, .1, .29, .148);
  const mHand = makeHand(dress ? [[-.01, -.08], [.01, -.08], [.042, .17], [0, .69], [-.042, .17]] : [[-.024, -.09], [.024, -.09], [.036, .54], [0, .7], [-.036, .54]], .032, .14, .52, .166);
  // библиотека стрелок (только у «dress»): дофин, меч, лист — все лежат в модели, показывается один набор
  const handSets = [[hHand.children[0], mHand.children[0]]];
  if (dress) for (const [hp, mp] of [
    [[[-.03, -.08], [.03, -.08], [.03, .35], [0, .42], [-.03, .35]], [[-.023, -.08], [.023, -.08], [.023, .62], [0, .69], [-.023, .62]]],
    [[[-.01, -.08], [.01, -.08], [.03, .04], [.06, .2], [0, .43], [-.06, .2], [-.03, .04]], [[-.008, -.08], [.008, -.08], [.024, .1], [.048, .34], [0, .7], [-.048, .34], [-.024, .1]]],
  ]) {
    const a = add(extrude(poly(hp), .008, .003), polished, 0, 0, 0, hHand), b = add(extrude(poly(mp), .008, .003), polished, 0, 0, 0, mHand);
    a.visible = b.visible = false; handSets.push([a, b]);
  }
  const setHands = i => handSets.forEach((set, j) => set.forEach(m => { m.visible = j === i; }));
  const sHand = new THREE.Group(); sHand.position.z = .186; cur.add(sHand);
  const secMat = dress ? blued : orange;
  { const g = new THREE.BoxGeometry(dress ? .009 : .011, .98, .006); g.translate(0, .98 / 2 - .22, 0); add(g, secMat, 0, 0, 0, sHand); }
  cylZ(dress ? .026 : .036, .006, secMat, 0, -.16, 0, sHand);
  cylZ(.052, .05, polished, 0, 0, .168);
  cylZ(.024, .012, dress ? polished : orange, 0, 0, .198);
  // стрелки субциферблатов
  const subHands = (dress ? [] : SUB).map(([x, y]) => {
    const g = new THREE.Group(); g.position.set(x, y, .118); cur.add(g);
    add(extrude(poly([[-.012, -.03], [.012, -.03], [.005, .15], [-.005, .15]]), .004), polished, 0, 0, 0, g);
    cylZ(.02, .008, polished, 0, 0, .004, g);
    return g;
  });

  // сапфировое стекло
  cylZ(.794, .05, glassMat, 0, 0, .236, L.glass, 96);                                      // толстое «коробчатое» стекло
  add(new THREE.TorusGeometry(.782, .013, 8, 96), rubber, 0, 0, .209, L.glass);            // уплотнитель
  cylZ(.018, .15, polished, 0, 0, .1, L.hands, 16);                                        // ось стрелок

  /* ── головка, защита головки, кнопки хронографа ── */
  cur = L.body;
  const crown = add(extrude(gearShape(.105, .092, 22), .13), polished, 1.035, 0, -.03); crown.rotation.y = Math.PI / 2;
  { const m = add(new THREE.CylinderGeometry(.06, .06, .06, 24), brushed, 1.01, 0, -.03); m.rotation.z = Math.PI / 2; }
  { const m = add(new THREE.CylinderGeometry(.09, .078, .025, 24), polished, 1.178, 0, -.03); m.rotation.z = -Math.PI / 2; }
  { const m = add(new THREE.CylinderGeometry(.03, .03, .01, 16), dress ? polished : orange, 1.193, 0, -.03); m.rotation.z = Math.PI / 2; }
  for (const s of dress ? [] : [-1, 1]) {                                                            // у «dress» нет кнопок хронографа
    add(new RoundedBoxGeometry(.1, .1, .15, 2, .03), brushed, .985, s * .165, -.03);                   // защита головки
    const p = new THREE.Group(); p.rotation.z = s * .6; p.position.z = -.03; cur.add(p);                // кнопка
    let m = add(new THREE.CylinderGeometry(.078, .078, .06, 24), brushed, 1.0, 0, 0, p); m.rotation.z = Math.PI / 2;
    m = add(new THREE.CylinderGeometry(.06, .06, .11, 24), polished, 1.075, 0, 0, p); m.rotation.z = Math.PI / 2;
  }

  /* ── ушки ── */
  {
    const s = new THREE.Shape();
    s.moveTo(.7, .1); s.lineTo(.96, .1); s.quadraticCurveTo(1.2, .07, 1.27, -.13);
    s.lineTo(1.27, -.19); s.quadraticCurveTo(1.25, -.235, 1.15, -.22); s.lineTo(.7, -.2); s.closePath();
    const g = extrude(s, .2, .02); g.translate(0, 0, -.1);
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));           // профиль (y,z), выдавливание по x
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const l = add(g, brushed, sx * .55, 0, 0); l.scale.y = sy;
      const pin = add(new THREE.CylinderGeometry(.028, .028, .012, 16), polished, sx * .672, sy * 1.14, -.12); pin.rotation.z = Math.PI / 2;  // винт шпильки
    }
  }

  /* ── браслет: пятирядные звенья вдоль эллипса ── */
  {
    const A = 1.75, B = 1.2, Z0 = .1, phi0 = Math.asin(1.0 / A), phi1 = TAU - phi0, N = 2000;
    const pt = p => [A * Math.sin(p), Z0 - B + B * Math.cos(p)];
    const cum = [0]; let prev = pt(phi0);
    for (let i = 1; i <= N; i++) { const q = pt(phi0 + (phi1 - phi0) * i / N); cum.push(cum[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1])); prev = q; }
    const L = cum[N], rows = Math.round(L / .27), pitch = L / rows, len = pitch - .022;
    const gMid = new RoundedBoxGeometry(.25, len, .11, 3, .035), gIn = new RoundedBoxGeometry(.09, len * .82, .1, 3, .03), gOut = new RoundedBoxGeometry(.17, len, .115, 3, .035);
    const g3Mid = new RoundedBoxGeometry(.33, len, .115, 3, .035), g3Out = new RoundedBoxGeometry(.235, len, .11, 3, .035);
    let j = 0;
    for (let k = 0; k < rows; k++) {
      const target = (k + .5) * pitch; while (cum[j] < target) j++;
      const p = phi0 + (phi1 - phi0) * j / N, [y, z] = pt(p);
      const row = new THREE.Group(); row.position.set(0, y, z);
      row.rotation.x = Math.atan2(-B * Math.sin(p), A * Math.cos(p));
      row.scale.x = 1 - .15 * Math.sin(Math.PI * k / (rows - 1));                                       // сужение к застёжке
      if (dress) {                                                                                      // трёхрядный браслет
        add(g3Mid, brushed, 0, 0, 0, row);
        for (const s of [-1, 1]) add(g3Out, brushed, s * .292, 0, 0, row);
      } else {
        add(gMid, brushed, 0, 0, 0, row);
        for (const s of [-1, 1]) { add(gIn, polished, s * .178, 0, 0, row); add(gOut, brushed, s * .316, 0, 0, row); }
      }
      (y >= 0 ? strapTop : strapBot).add(row);
    }
    // концевые звенья между ушками
    for (const s of [-1, 1]) { const e = add(new RoundedBoxGeometry(.84, .24, .15, 3, .04), brushed, 0, s * .93, -.075, s > 0 ? strapTop : strapBot); e.rotation.x = -s * .22; }
    cur = strapBot;
    // застёжка
    const zc = Z0 - 2 * B;
    add(new RoundedBoxGeometry(.7, .8, .05, 3, .02), brushed, 0, 0, zc - .08);
    add(new RoundedBoxGeometry(.3, .22, .05, 3, .02), polished, 0, 0, zc - .115);
    for (const s of [-1, 1]) add(new RoundedBoxGeometry(.04, .16, .05, 2, .015), polished, s * .365, 0, zc - .07);
  }

  /* ── задняя крышка с видимым механизмом ── */
  const back = layer(-2.3, -.16, true), cover = layer(-3.1, -.16, true);
  cylZ(.6, .12, dress ? brushed : brass, 0, 0, -.062, back, 64);   // тело механизма: у «dress» стальное, как у NH35
  cylZ(.615, .03, polished, 0, 0, -.02, back, 64);             // стальное кольцо-держатель
  add(extrude(gearShape(.825, .825, 48, .6), .03), brushed, 0, 0, .026, cover);   // толщина задней крышки
  back.userData.spin = true;                                  // при разборке механизм разворачивается лицом к зрителю
  // платина с женевскими полосами
  const plateCv = makeCanvas(1024), plateTex = colorTex(plateCv);
  {
    const c = plateCv.getContext('2d');
    c.fillStyle = dress ? '#a4a9b0' : '#b8bcc2'; c.fillRect(0, 0, 1024, 1024);
    if (dress) {
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
    const m = add(extrude(gearShape(r, r * .88, teeth, r * .22), .008), gold, x, y, .01, back);
    m.userData.speed = speed; return m;
  });
  // баланс
  const balance = new THREE.Group(); balance.position.set(.255, -.255, .014); back.add(balance);
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
  // ротор автоподзавода
  const rotor = new THREE.Group(); rotor.position.z = .03; back.add(rotor);
  let rotorSeg;
  const steelRotor = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: .34, roughnessMap: brushTex, envMapIntensity: 1.9, side: THREE.DoubleSide });
  const rotorMats = [rose, steelRotor, gold, blued];             // библиотека роторов
  const setRotor = i => { rotorSeg.material = rotorMats[i] || rotorMats[0]; };
  {
    const s = new THREE.Shape();
    s.moveTo(.56, 0); s.absarc(0, 0, .56, 0, Math.PI, false); s.lineTo(-.44, 0); s.absarc(0, 0, .44, Math.PI, 0, true); s.closePath();
    rotorSeg = add(extrude(s, .022, .004), dress ? rose : gold, 0, 0, 0, rotor);                        // тяжёлый сегмент
    if (dress) {
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
    for (const a of [.55, Math.PI / 2, Math.PI - .55]) { const h = new THREE.Path(); h.absarc(Math.cos(a) * .27, Math.sin(a) * .27, .085, 0, TAU, true); web.holes.push(h); }
    add(extrude(web, .008), brushed, 0, 0, .004, rotor);                                                // ажурная перемычка
    cylZ(.09, .014, polished, 0, 0, .012, rotor, 32);
    cylZ(.03, .02, blued, 0, 0, .014, rotor, 16);
  }
  // стекло и гравированное кольцо крышки
  add(new THREE.CircleGeometry(.6, 96), glassMat, 0, 0, .054, cover);
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
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + .26; cylZ(.022, .01, new THREE.MeshStandardMaterial({ color: 0x555a61, metalness: 1, roughness: .4 }), Math.cos(a) * .79, Math.sin(a) * .79, .062, cover, 6); }

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
  let ex = 0;                                                    // 0 — собраны, 1 — разобраны
  const anchor = (i, side, v) => { const p = parts[i]; v.set(0, side * (p.r + (p.oy || 0) * ex), p.z + p.off * ex); return watch.localToWorld(v); };

  function update(t, exploded = false) {
    ex += ((exploded ? 1 : 0) - ex) * .07;
    for (const g of layers) { g.position.z = g.userData.base + g.userData.off * ex; g.position.y = g.userData.oy * ex; }
    const turn = ex * ex * (3 - 2 * ex);
    back.rotation.y = Math.PI * (1 - turn); back.scale.setScalar(1 + .25 * turn);
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
    orange.color.set(v.accent); brushed.color.set(v.metal[0]); polished.color.set(v.metal[1]); bezelMat.color.set(v.metal[1]);
  }
  return { watch, update, parts, anchor, setVariant, setHands, setRotor };
}
