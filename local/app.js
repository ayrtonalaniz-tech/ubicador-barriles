(function(){
  "use strict";
  // ================== Ubicador de Barriles — versión local ==================
  // Todo se guarda en este dispositivo (localStorage). No usa internet ni cuentas.

  const ESTADOS = [
    {k:"servicio", t:"En servicio"},
    {k:"retirar", t:"Vacío, para retirar"},
    {k:"fabrica", t:"En fábrica, lleno"},
    {k:"limpieza", t:"En limpieza"}
  ];
  const KEY = "barriles-local-v1";
  const BACKUP_DIAS = 7;
  const estadoTxt = k => (ESTADOS.find(e=>e.k===k)||{t:k||"—"}).t;
  const $ = s => document.querySelector(s);
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm = s => String(s||"").trim().toUpperCase();
  const normL = s => String(s||"").trim().replace(/\s+/g," ").toLocaleUpperCase("es-AR");
  const sinTilde = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const canon = (v, existentes) => { const n=normL(v); if(!n) return n; const k=sinTilde(n); const hit=existentes.find(x=>x && sinTilde(x)===k); return hit||n; };
  const pill = k => `<span class="pill st-${esc(k)}">${esc(estadoTxt(k))}</span>`;
  const ms = v => v ? (typeof v==="number" ? v : Date.parse(v)) : 0;
  const BASE = location.origin + location.pathname.replace(/index\.html$/,"");
  const ICON_CAM = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 12h8"/></svg>';

  // ---------- almacenamiento (por usuario) ----------
  // db.usuarios: { nombre: {salt, hash, creado} }   db.cuentas: { nombre: {negocio, lastBackup, lastMov, barriles} }
  const cuentaVacia = () => ({ negocio:"", lastBackup:0, lastMov:null, barriles:{} });
  let db = { version:2, usuarios:{}, cuentas:{}, sesion:null, sinUsuario:null };
  let storeOk = true;
  function loadDb(){
    try{
      const raw=localStorage.getItem(KEY); if(!raw) return;
      const d=JSON.parse(raw);
      if(d && d.version===2){ db=Object.assign(db,d); return; }
      if(d && d.barriles){ // datos de antes de los usuarios: quedan para el primer usuario que se cree
        db.sinUsuario={ negocio:d.negocio||"", lastBackup:d.lastBackup||0, lastMov:d.lastMov||null, barriles:d.barriles||{} };
      }
    }catch(e){ storeOk=false; }
  }
  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch(e){ storeOk=false; $("#storeErr").hidden=false; return false; }
  }
  const yo = () => db.sesion && db.usuarios[db.sesion] ? db.sesion : null;
  const cu = () => { const u=yo(); if(!u) return cuentaVacia(); return (db.cuentas[u] = db.cuentas[u] || cuentaVacia()); };
  const lista = () => Object.values(cu().barriles).sort((a,b)=>a.codigo.localeCompare(b.codigo,"es",{numeric:true}));

  // contraseñas: PBKDF2 (SHA-256) con sal propia por usuario; nunca se guarda la contraseña
  const hex = buf => [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,"0")).join("");
  async function hashPass(pass, saltHex){
    const enc=new TextEncoder();
    const salt=new Uint8Array(saltHex.match(/../g).map(h=>parseInt(h,16)));
    const key=await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({name:"PBKDF2", salt, iterations:150000, hash:"SHA-256"}, key, 256));
  }
  const normUser = u => String(u||"").trim().toLowerCase();

  // ---------- estado de pantalla ----------
  let view="barriles", fichaCode=null, fEstado=null, fLugar=null, sel=new Set();

  $("#n-estado").innerHTML = ESTADOS.map(e=>`<option value="${e.k}">${e.t}</option>`).join("");
  $("#n-estado").value="fabrica";

  function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(t._h);t._h=setTimeout(()=>t.hidden=true,2600);}
  function fmt(v){ const n=ms(v); if(!n) return "—"; const d=new Date(n); return d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"})+" "+d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}); }
  function hace(v){ const n=ms(v); if(!n) return ""; const m=Math.round((Date.now()-n)/60000); if(m<60) return "hace "+Math.max(m,1)+" min"; const h=Math.round(m/60); if(h<48) return "hace "+h+" h"; return "hace "+Math.round(h/24)+" días"; }

  // ---------- rutas ----------
  const TABS=["barriles","etiquetas","ajustes"];
  function readRoute(){
    const p=new URLSearchParams(location.search).get("b");
    const h=decodeURIComponent((location.hash||"").replace(/^#/,""));
    if(p){ fichaCode=norm(p); }
    else if(TABS.includes(h)){ fichaCode=null; view=h; }
    else if(/^[A-Za-z0-9-]+$/.test(h)){ fichaCode=norm(h); }
    else fichaCode=null;
  }
  function go(v){ view=v; fichaCode=null; history.pushState(null,"",BASE+(v==="barriles"?"":"#"+v)); render(); window.scrollTo(0,0); }
  function openFicha(c){ fichaCode=norm(c); history.pushState(null,"",BASE+"?b="+encodeURIComponent(fichaCode)); render(); window.scrollTo(0,0); }
  window.addEventListener("popstate",()=>{ stopScan(); readRoute(); render(); });
  document.querySelectorAll("nav.tabs button").forEach(b=>b.addEventListener("click",()=>go(b.dataset.tab)));
  $("#findForm").addEventListener("submit",e=>{e.preventDefault(); const c=norm($("#findInput").value); if(!c) return; openFicha(c); $("#findInput").value="";});


  // ---------- celular: escanear junto al título y "Nuevo barril" arriba del buscador ----------
  const mqCel = window.matchMedia("(max-width:560px)");
  const scanHome = { el: document.getElementById("btnScan"), parent: document.getElementById("btnScan").parentNode, next: document.getElementById("btnScan").nextSibling };
  const nuevoHome = { el: document.getElementById("btnNuevo"), parent: document.getElementById("btnNuevo").parentNode };
  function acomodarCelular(){
    const cel=mqCel.matches;
    const sec=[...document.querySelectorAll("main > section")].find(x=>!x.hidden);
    const slot= cel && sec ? sec.querySelector(".scan-slot") : null;
    const sb=scanHome.el;
    if(slot){ if(sb.parentNode!==slot) slot.appendChild(sb); sb.classList.add("inline"); }
    else { if(sb.parentNode!==scanHome.parent) scanHome.parent.insertBefore(sb, scanHome.next); sb.classList.remove("inline"); }
    const nb=nuevoHome.el, ns=document.getElementById("nuevoSlot");
    if(cel && ns){ if(nb.parentNode!==ns) ns.appendChild(nb); }
    else if(nb.parentNode!==nuevoHome.parent) nuevoHome.parent.appendChild(nb);
  }
  try{ mqCel.addEventListener("change", acomodarCelular); }catch(_){ mqCel.addListener && mqCel.addListener(acomodarCelular); }

  // ---------- render ----------
  function render(){ renderInner(); acomodarCelular(); }
  function renderInner(){
    const logged=!!yo();
    document.body.classList.toggle("sin-sesion", !logged);
    $("#userBox").hidden=!logged; $("#userName").textContent=yo()||"";
    if(!logged){ ["ficha","barriles","etiquetas","ajustes"].forEach(k=>$("#v-"+k).hidden=true); $("#v-login").hidden=false; $("#backupNote").hidden=true; renderLogin(); return; }
    $("#v-login").hidden=true;
    const v = fichaCode ? "ficha" : view;
    document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-current", String(v===b.dataset.tab)));
    ["ficha","barriles","etiquetas","ajustes"].forEach(k=>$("#v-"+k).hidden = v!==k);
    $("#bizName").textContent = cu().negocio || "";
    $("#storeErr").hidden = storeOk;
    const all=lista();
    const cerv=[...new Set(all.map(b=>b.cerveza).filter(Boolean))].sort();
    const lug=[...new Set(["FÁBRICA",...all.map(b=>b.cerveceria).filter(Boolean)])].sort();
    $("#dl-cervezas").innerHTML=cerv.map(x=>`<option value="${esc(x)}">`).join("");
    $("#dl-lugares").innerHTML=lug.map(x=>`<option value="${esc(x)}">`).join("");
    // recordatorio de copia
    const sinCopia = all.length>0 && (!cu().lastBackup || Date.now()-cu().lastBackup > BACKUP_DIAS*864e5);
    $("#backupNote").hidden = !sinCopia || v==="ajustes";
    $("#backupMsg").innerHTML = cu().lastBackup ? `Tu última copia de seguridad es de <b>${esc(hace(cu().lastBackup))}</b>. Hacé una nueva para no perder datos.` : `<b>Todavía no hiciste ninguna copia de seguridad.</b> Si perdés este dispositivo, perdés los datos.`;
    if(v==="ficha") renderFicha();
    else if(v==="barriles") renderLista();
    else if(v==="etiquetas") renderEtiquetas();
    else renderAjustes();
  }

  function renderLista(){
    const all=lista();
    const counts={}; all.forEach(b=>counts[b.estado]=(counts[b.estado]||0)+1);
    $("#summary").innerHTML = ESTADOS.map(e=>`<button type="button" class="sum" data-st="${e.k}" aria-pressed="${fEstado===e.k}"><b>${counts[e.k]||0}</b>${pill(e.k)}</button>`).join("");
    $("#summary").querySelectorAll(".sum").forEach(b=>b.onclick=()=>{fEstado = fEstado===b.dataset.st?null:b.dataset.st; renderLista();});
    const byL={}; all.forEach(b=>{const l=b.cerveceria||"SIN UBICACIÓN"; byL[l]=(byL[l]||0)+1;});
    const ls=Object.entries(byL).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    $("#places").innerHTML = ls.length? ls.map(([l,n])=>`<button type="button" data-l="${esc(l)}" aria-pressed="${fLugar===l}"><span>${esc(l)}</span><span class="n">${n}</span></button>`).join("") : `<p style="margin:0;color:var(--muted);font-size:14px">Todavía no hay barriles ubicados.</p>`;
    $("#places").querySelectorAll("button").forEach(b=>b.onclick=()=>{fLugar = fLugar===b.dataset.l?null:b.dataset.l; renderLista();});
    if(all.length) $("#places").insertAdjacentHTML("beforeend", `<div class="places-total"><span>Total de barriles</span><span class="n">${all.length}</span></div>`);
    const q=$("#filtro").value.trim().toLowerCase();
    const rows=all.filter(b=>(!fEstado||b.estado===fEstado)&&(!fLugar||(b.cerveceria||"SIN UBICACIÓN")===fLugar)&&(!q||[b.codigo,b.cerveza,b.cerveceria].join(" ").toLowerCase().includes(q)));
    $("#limpiarFiltros").hidden = !(fEstado||fLugar||q);
    $("#tbody").innerHTML = rows.map(b=>`<tr data-c="${esc(b.codigo)}"><td class="code">${esc(b.codigo)}<span class="sub">${esc(b.litros||"")} L</span></td><td>${esc(b.cerveza||"—")}</td><td>${esc(b.cerveceria||"—")}</td><td>${pill(b.estado)}</td><td style="white-space:nowrap;color:var(--muted);font-size:13px">${esc(hace(b.actualizado))}</td></tr>`).join("");
    $("#tbody").querySelectorAll("tr").forEach(tr=>tr.onclick=()=>openFicha(tr.dataset.c));
    const em=$("#emptyList");
    if(!all.length){ em.hidden=false; em.innerHTML=`<h3>Todavía no hay barriles</h3><p>Cargá el primero con <b>+ Nuevo barril</b>: el código que va a llevar su etiqueta, la capacidad, la cerveza y dónde está.</p>`; }
    else if(!rows.length){ em.hidden=false; em.innerHTML=`<p>Ningún barril coincide con el filtro.</p>`; }
    else em.hidden=true;
  }
  $("#filtro").addEventListener("input",renderLista);
  $("#limpiarFiltros").onclick=()=>{fEstado=null;fLugar=null;$("#filtro").value="";renderLista();};

  $("#btnNuevo").onclick=()=>{ $("#nuevoPanel").hidden=false; $("#n-codigo").focus(); };
  $("#nuevoCancel").onclick=()=>{ $("#nuevoPanel").hidden=true; $("#nuevoErr").textContent=""; };
  $("#nuevoForm").addEventListener("submit",e=>{
    e.preventDefault();
    const codigo=norm($("#n-codigo").value);
    if(!/^[A-Z0-9-]+$/.test(codigo)){ $("#nuevoErr").textContent="El código solo puede tener letras, números y guiones."; return; }
    if(cu().barriles[codigo]){ $("#nuevoErr").textContent="Ya existe un barril con el código "+codigo+"."; return; }
    const now=Date.now();
    const b={codigo, litros:Number($("#n-litros").value), cerveza:canon($("#n-cerveza").value, lista().map(x=>x.cerveza)), cerveceria:canon($("#n-lugar").value, ["FÁBRICA",...lista().map(x=>x.cerveceria)])||"FÁBRICA", estado:$("#n-estado").value, nota:"", actualizado:now};
    b.historial=[{fecha:now, cerveceria:b.cerveceria, cerveza:b.cerveza, estado:b.estado, nota:"Alta del barril"}];
    cu().barriles[codigo]=b;
    if(!save()){ delete cu().barriles[codigo]; $("#nuevoErr").textContent="No se pudo guardar en este dispositivo."; return; }
    $("#nuevoForm").reset(); $("#n-estado").value="fabrica"; $("#n-litros").value="30"; $("#nuevoPanel").hidden=true; $("#nuevoErr").textContent="";
    toast("Barril "+codigo+" guardado"); render();
  });

  // ---------- ficha ----------
  function renderFicha(){
    const box=$("#v-ficha");
    const b=cu().barriles[fichaCode];
    if(!b){
      box.dataset.code="";
      box.innerHTML=`<button class="back" type="button" id="fBack">← Todos los barriles</button><div class="panel" style="text-align:center;padding:30px"><h2 class="sec" style="justify-content:center">Barril ${esc(fichaCode)}</h2><p class="lead" style="margin:8px auto 16px">No hay ningún barril con ese código en este dispositivo.</p><button class="btn primary" type="button" id="fAlta">Dar de alta ${esc(fichaCode)}</button></div>`;
      $("#fBack").onclick=()=>go("barriles");
      $("#fAlta").onclick=()=>{ const c=fichaCode; go("barriles"); $("#nuevoPanel").hidden=false; $("#n-codigo").value=c; $("#n-cerveza").focus(); };
      return;
    }
    const same = box.dataset.code===b.codigo;
    const keep = id => { const el=same && document.getElementById(id); return el?el.value:null; };
    const draft={lugar:keep("m-lugar"),cerveza:keep("m-cerveza"),estado:keep("m-estado"),nota:keep("m-nota")};
    box.dataset.code=b.codigo;
    const hist=(b.historial||[]).slice().sort((a,c)=>c.fecha-a.fecha);
    const lastMov=cu().lastMov;
    box.innerHTML=`
      <button class="back" type="button" id="fBack">← Todos los barriles</button>
      <div class="plate">
        <div class="code">BARRIL ${esc(b.codigo)} · ${esc(b.litros||"")} L</div>
        <div class="label" style="color:color-mix(in srgb,var(--steel-fg) 60%,transparent);margin-top:14px">Está en</div>
        <div class="where">${esc(b.cerveceria||"Sin ubicación")}</div>
        <div class="beer">${b.cerveza?esc(b.cerveza):'<span style="opacity:.6">Sin cerveza asignada</span>'}</div>
        <div class="meta"><span>${pill(b.estado)}</span><span>Actualizado <b>${esc(fmt(b.actualizado))}</b></span>${b.nota?`<span>Nota: <b>${esc(b.nota)}</b></span>`:""}</div>
      </div>
      <div class="fgrid">
        <div class="panel"><h3 style="font-size:17px;margin-bottom:12px">Registrar movimiento</h3>
          <form id="movForm" class="stack" style="gap:12px">
            ${lastMov?`<button type="button" class="chip" id="mRepeat">↻ Repetir último: <b>${esc(lastMov.cerveceria)}</b> · ${esc(estadoTxt(lastMov.estado))}</button>`:""}
            <div class="grid-form">
              <label class="field"><span class="label">Cervecería / ubicación</span><input id="m-lugar" class="up" list="dl-lugares" value="${esc(draft.lugar??b.cerveceria??"")}" required></label>
              <label class="field"><span class="label">Cerveza</span><input id="m-cerveza" class="up" list="dl-cervezas" value="${esc(draft.cerveza??b.cerveza??"")}"></label>
              <label class="field"><span class="label">Estado</span><select id="m-estado">${ESTADOS.map(e=>`<option value="${e.k}" ${e.k===(draft.estado||b.estado)?"selected":""}>${e.t}</option>`).join("")}</select></label>
            </div>
            <label class="field"><span class="label">Nota (opcional)</span><textarea id="m-nota" placeholder="Ej.: entregado a Juan, lote 0412">${esc(draft.nota||"")}</textarea></label>
            <div class="row"><button class="btn primary" type="submit">Guardar movimiento</button><button class="btn" type="button" id="mScanNext">${ICON_CAM} Escanear otro barril</button><span id="movErr" class="err"></span></div>
          </form>
        </div>
        <div class="panel"><h3 style="font-size:17px;margin-bottom:6px">Historial</h3>
          ${hist.length?`<ul class="hist">${hist.map(h=>`<li><time>${esc(fmt(h.fecha))}</time><div><b>${esc(h.cerveceria||"—")}</b> · ${esc(h.cerveza||"sin cerveza")}<br>${pill(h.estado)}${h.nota?` <span style="color:var(--muted)">${esc(h.nota)}</span>`:""}</div></li>`).join("")}</ul>`:`<p style="color:var(--muted);margin:0">Sin movimientos registrados.</p>`}
        </div>
      </div>`;
    $("#fBack").onclick=()=>go("barriles");
    const rp=$("#mRepeat"); if(rp) rp.onclick=()=>{ $("#m-lugar").value=lastMov.cerveceria; $("#m-estado").value=lastMov.estado; rp.classList.add("on"); };
    $("#mScanNext").onclick=startScan;
    $("#movForm").addEventListener("submit",e=>{
      e.preventDefault();
      const now=Date.now();
      const mov={fecha:now, cerveceria:canon($("#m-lugar").value, ["FÁBRICA",...lista().map(x=>x.cerveceria)]), cerveza:canon($("#m-cerveza").value, lista().map(x=>x.cerveza)), estado:$("#m-estado").value, nota:$("#m-nota").value.trim()};
      const prev=JSON.stringify(b);
      Object.assign(b,{cerveceria:mov.cerveceria, cerveza:mov.cerveza, estado:mov.estado, nota:mov.nota, actualizado:now});
      b.historial=[mov,...(b.historial||[])].slice(0,200);
      cu().lastMov={cerveceria:mov.cerveceria, estado:mov.estado};
      if(!save()){ cu().barriles[b.codigo]=JSON.parse(prev); $("#movErr").textContent="No se pudo guardar en este dispositivo."; return; }
      box.dataset.code="";
      toast("Movimiento guardado · "+b.codigo+" → "+mov.cerveceria);
      render();
    });
  }

  // ---------- etiquetas ----------
  const qrUrl = c => BASE + "?b=" + encodeURIComponent(c);
  function renderEtiquetas(){
    const list=lista();
    $("#emptyLabels").hidden=!!list.length;
    [...sel].forEach(c=>{ if(!cu().barriles[c]) sel.delete(c); });
    $("#labels").innerHTML=list.map(b=>`<div class="lab" data-lab="${esc(b.codigo)}"><input type="checkbox" class="chk" data-c="${esc(b.codigo)}" ${sel.has(b.codigo)?"checked":""} aria-label="Incluir ${esc(b.codigo)}"><div class="q" data-q="${esc(b.codigo)}"></div><div class="c">${esc(b.codigo)}</div><div class="s">${esc(b.litros||"")} L${cu().negocio?" · "+esc(cu().negocio):""}</div></div>`).join("");
    if(window.QRCode) $("#labels").querySelectorAll("[data-q]").forEach(el=>new QRCode(el,{text:qrUrl(el.dataset.q),width:260,height:260,colorDark:"#000000",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M}));
    $("#labels").querySelectorAll("input[data-c]").forEach(i=>i.onchange=()=>{i.checked?sel.add(i.dataset.c):sel.delete(i.dataset.c); updSel();});
    updSel();
  }
  function updSel(){
    $("#selCount").textContent = sel.size? sel.size+" seleccionadas" : "Ninguna marcada: se imprimen todas";
    $("#selAll").checked = lista().length>0 && sel.size===lista().length;
    document.querySelectorAll(".lab").forEach(l=>l.classList.toggle("skip", sel.size>0 && !sel.has(l.dataset.lab)));
  }
  $("#selAll").onchange=e=>{ sel = e.target.checked? new Set(Object.keys(cu().barriles)) : new Set(); renderEtiquetas(); };
  $("#btnImprimir").onclick=()=>window.print();

  // ---------- ajustes: nombre, copia, restaurar, planilla, borrar ----------
  function renderAjustes(){
    if(document.activeElement!==$("#bizInput")) $("#bizInput").value=cu().negocio||"";
    $("#lastBackup").textContent = cu().lastBackup ? "Última copia: "+fmt(cu().lastBackup)+" ("+hace(cu().lastBackup)+")" : "Todavía no hiciste ninguna copia.";
  }
  $("#bizForm").addEventListener("submit",e=>{ e.preventDefault(); cu().negocio=normL($("#bizInput").value); save(); toast("Nombre guardado"); render(); });

  function bajar(nombre, contenido, tipo){
    const blob=new Blob([contenido],{type:tipo});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=nombre;
    document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},1500);
  }
  const hoy = () => new Date().toISOString().slice(0,10);
  function backup(){
    const data={app:"ubicador-barriles-local", version:1, usuario:yo(), exportado:new Date().toISOString(), negocio:cu().negocio, barriles:lista()};
    bajar("barriles-copia-"+yo()+"-"+hoy()+".json", JSON.stringify(data,null,1), "application/json");
    cu().lastBackup=Date.now(); save(); toast("Copia descargada. Guardala en tu mail o en Drive."); render();
  }
  $("#btnBackup").onclick=backup;
  $("#backupNow").onclick=backup;

  let pendiente=null;
  $("#restoreFile").addEventListener("change",async e=>{
    $("#restoreErr").textContent=""; $("#restoreConfirm").hidden=true; pendiente=null;
    const f=e.target.files&&e.target.files[0]; e.target.value="";
    if(!f) return;
    try{
      const d=JSON.parse(await f.text());
      if(d.app!=="ubicador-barriles-local" || !Array.isArray(d.barriles)) throw new Error("formato");
      const map={};
      d.barriles.forEach(b=>{ const c=norm(b.codigo); if(!/^[A-Z0-9-]+$/.test(c)) return; map[c]={codigo:c, litros:Number(b.litros)||null, cerveza:normL(b.cerveza), cerveceria:normL(b.cerveceria), estado:ESTADOS.some(x=>x.k===b.estado)?b.estado:"fabrica", nota:String(b.nota||""), actualizado:ms(b.actualizado)||Date.now(), historial:Array.isArray(b.historial)?b.historial.slice(0,200):[]}; });
      pendiente={negocio:normL(d.negocio||""), barriles:map};
      $("#restoreInfo").innerHTML=`El archivo tiene <b>${Object.keys(map).length}</b> barriles (copia del ${esc(fmt(d.exportado))}). Los <b>${lista().length}</b> barriles actuales se reemplazan.`;
      $("#restoreConfirm").hidden=false;
    }catch(_){ $("#restoreErr").textContent="Ese archivo no es una copia de esta app. Elegí el archivo barriles-copia-….json"; }
  });
  $("#restoreNo").onclick=()=>{ pendiente=null; $("#restoreConfirm").hidden=true; };
  $("#restoreYes").onclick=()=>{
    if(!pendiente) return;
    const prev=JSON.stringify(db);
    cu().barriles=pendiente.barriles; if(pendiente.negocio) cu().negocio=pendiente.negocio;
    if(!save()){ db=JSON.parse(prev); $("#restoreErr").textContent="No se pudo guardar en este dispositivo."; return; }
    pendiente=null; $("#restoreConfirm").hidden=true; toast("Datos restaurados"); render();
  };

  $("#btnCsv").onclick=()=>{
    const q=v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`;
    const lines=[["Código","Litros","Cerveza","Ubicación","Estado","Actualizado","Nota"].map(q).join(";")]
      .concat(lista().map(b=>[b.codigo,b.litros,b.cerveza,b.cerveceria,estadoTxt(b.estado),fmt(b.actualizado),b.nota].map(q).join(";")));
    bajar("barriles-"+hoy()+".csv", "﻿"+lines.join("\r\n"), "text/csv;charset=utf-8");
    toast("Planilla descargada");
  };

  $("#wipeAsk").onclick=()=>{ $("#wipeCount").textContent=lista().length; $("#wipeConfirm").hidden=false; };
  $("#wipeNo").onclick=()=>{ $("#wipeConfirm").hidden=true; };
  $("#wipeYes").onclick=()=>{ cu().barriles={}; cu().lastMov=null; save(); $("#wipeConfirm").hidden=true; toast("Datos borrados"); render(); };

  // ---------- escanear QR (sin internet: usa el lector incluido) ----------
  let scanStream=null, scanTimer=null, detector=null;
  function codeFrom(t){
    t=String(t||"").trim();
    try{ const u=new URL(t); const b=u.searchParams.get("b"); if(b) return norm(b); const h=u.hash.replace(/^#/,""); if(/^[A-Za-z0-9-]+$/.test(h)) return norm(h); return null; }catch(_){}
    return /^[A-Za-z0-9-]+$/.test(t) ? norm(t) : null;
  }
  async function startScan(){
    const ov=$("#scanView"), msg=$("#scanMsg"); ov.hidden=false; msg.textContent="Apuntá la cámara al QR del barril";
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ msg.textContent="Este navegador no permite usar la cámara. Escribí el código en el buscador de arriba."; return; }
    try{ if("BarcodeDetector" in window && !detector){ const f=await BarcodeDetector.getSupportedFormats(); if(f.includes("qr_code")) detector=new BarcodeDetector({formats:["qr_code"]}); } }catch(_){}
    if(!detector && !window.jsQR){ msg.textContent="El lector todavía se está cargando. Probá de nuevo en un segundo."; return; }
    try{ scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false}); }
    catch(e){ msg.textContent = e&&e.name==="NotAllowedError" ? "La cámara está bloqueada. Permití el acceso a la cámara para esta app en la configuración." : "No se pudo abrir la cámara."; return; }
    if(ov.hidden){ stopScan(); return; }
    const v=$("#scanVideo"); v.srcObject=scanStream; try{ await v.play(); }catch(_){}
    const c=document.createElement("canvas"), ctx=c.getContext("2d",{willReadFrequently:true});
    const tick=async()=>{
      if(!scanStream) return;
      let txt=null;
      if(v.readyState>=2 && v.videoWidth){
        if(detector){ try{ const r=await detector.detect(v); if(r&&r[0]) txt=r[0].rawValue; }catch(_){} }
        else if(window.jsQR){ const k=Math.min(1,720/Math.max(v.videoWidth,v.videoHeight)); c.width=Math.round(v.videoWidth*k); c.height=Math.round(v.videoHeight*k); ctx.drawImage(v,0,0,c.width,c.height); const r=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height,{inversionAttempts:"dontInvert"}); if(r) txt=r.data; }
      }
      if(txt){
        const code=codeFrom(txt);
        if(code){ stopScan(); try{ navigator.vibrate&&navigator.vibrate(60); }catch(_){} openFicha(code); setTimeout(()=>{ const f=$("#movForm"); if(f) f.scrollIntoView({behavior:"smooth",block:"center"}); },120); return; }
        msg.textContent="Ese QR no es de un barril. Probá con otro.";
      }
      scanTimer=setTimeout(tick,140);
    };
    tick();
  }
  function stopScan(){
    clearTimeout(scanTimer);
    if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
    const v=$("#scanVideo"); if(v) v.srcObject=null;
    $("#scanView").hidden=true;
  }
  $("#btnScan").onclick=startScan;
  $("#scanClose").onclick=stopScan;
  document.addEventListener("visibilitychange",()=>{ if(document.hidden) stopScan(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape" && !$("#scanView").hidden) stopScan(); });

  // ---------- usuarios ----------
  let loginModo="ingresar";
  function renderLogin(){
    const hay=Object.keys(db.usuarios).length>0;
    if(!hay) loginModo="crear";
    $("#loginTabs").hidden=!hay;
    document.querySelectorAll("#loginTabs button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.m===loginModo)));
    $("#lgTitle").textContent = loginModo==="crear" ? (hay?"Crear usuario":"Creá tu usuario") : "Ingresar";
    $("#lgPass2Box").hidden = loginModo!=="crear";
    $("#lgSubmit").textContent = loginModo==="crear" ? "Crear usuario" : "Ingresar";
    $("#lgPass").autocomplete = loginModo==="crear" ? "new-password" : "current-password";
    const n=db.sinUsuario?Object.keys(db.sinUsuario.barriles).length:0;
    $("#lgLegacy").hidden = !(loginModo==="crear" && n);
    $("#lgLegacy").innerHTML = n ? `Este dispositivo ya tiene <b>${n}</b> barril${n===1?"":"es"} cargado${n===1?"":"s"}: van a quedar en el primer usuario que se cree.` : "";
    $("#lgHint").textContent = loginModo==="crear" ? "Cada usuario ve solo sus barriles. Si te olvidás la contraseña no se puede recuperar: hacé copias de seguridad." : "";
  }
  document.querySelectorAll("#loginTabs button").forEach(b=>b.onclick=()=>{ loginModo=b.dataset.m; $("#lgErr").textContent=""; renderLogin(); $("#lgUser").focus(); });
  $("#lgForm").addEventListener("submit",async e=>{
    e.preventDefault(); const err=$("#lgErr"); err.textContent="";
    const u=normUser($("#lgUser").value), p=$("#lgPass").value;
    if(!window.crypto||!crypto.subtle){ err.textContent="Este navegador no permite crear usuarios. Abrí la app instalada o desde la dirección con https."; return; }
    const btn=$("#lgSubmit"); btn.disabled=true;
    try{
      if(loginModo==="crear"){
        if(!/^[a-z0-9._-]{3,20}$/.test(u)){ err.textContent="El usuario tiene que tener entre 3 y 20 letras o números, sin espacios."; return; }
        if(db.usuarios[u]){ err.textContent="Ya existe un usuario con ese nombre en este dispositivo."; return; }
        if(p.length<4){ err.textContent="La contraseña tiene que tener al menos 4 caracteres."; return; }
        if(p!==$("#lgPass2").value){ err.textContent="Las contraseñas no coinciden."; return; }
        const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
        db.usuarios[u]={ salt, hash:await hashPass(p,salt), creado:Date.now() };
        db.cuentas[u]= db.sinUsuario && Object.keys(db.usuarios).length===1 ? db.sinUsuario : cuentaVacia();
        if(Object.keys(db.usuarios).length===1) db.sinUsuario=null;
        db.sesion=u;
        if(!save()){ delete db.usuarios[u]; delete db.cuentas[u]; db.sesion=null; err.textContent="No se pudo guardar en este dispositivo."; return; }
        toast("Usuario "+u+" creado");
      } else {
        const rec=db.usuarios[u];
        if(!rec || await hashPass(p,rec.salt)!==rec.hash){ err.textContent="Usuario o contraseña incorrectos."; return; }
        db.sesion=u; save(); toast("Hola, "+u);
      }
      $("#lgForm").reset(); view="barriles"; render();
    } finally { btn.disabled=false; }
  });
  $("#btnSalir").onclick=()=>{ stopScan(); db.sesion=null; save(); fichaCode=null; view="barriles"; sel=new Set(); loginModo="ingresar"; try{ history.replaceState(null,"",BASE); }catch(_){} render(); toast("Sesión cerrada"); };

  // ---------- instalar y funcionar sin internet ----------
  let installEvt=null;
  window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); installEvt=e; $("#btnInstalar").hidden=false; });
  $("#btnInstalar").onclick=async()=>{ if(!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt=null; $("#btnInstalar").hidden=true; };
  window.addEventListener("appinstalled",()=>{ $("#btnInstalar").hidden=true; toast("App instalada"); });
  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
  try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(_){}
  window.addEventListener("storage",e=>{ if(e.key===KEY){ loadDb(); render(); } });

  loadDb(); readRoute(); render();
})();
