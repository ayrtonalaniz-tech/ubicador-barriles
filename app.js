(function(){
  "use strict";
  const ESTADOS = [
    {k:"servicio", t:"En servicio"},
    {k:"retirar", t:"Vacío, para retirar"},
    {k:"fabrica", t:"En fábrica, lleno"},
    {k:"limpieza", t:"En limpieza"}
  ];
  const estadoTxt = k => (ESTADOS.find(e=>e.k===k)||{t:k||"—"}).t;
  const $ = s => document.querySelector(s);
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm = s => String(s||"").trim().toUpperCase();
  const normL = s => String(s||"").trim().replace(/\s+/g," ").toLocaleUpperCase("es-AR");
  const pill = k => `<span class="pill st-${esc(k)}">${esc(estadoTxt(k))}</span>`;
  const ms = v => v ? Date.parse(v) : 0;
  const BASE = location.origin + location.pathname.replace(/index\.html$/,"");

  let sb=null, session=null, barriles=[], ready=false;
  let view="barriles", fichaCode=null, fEstado=null, fLugar=null, sel=new Set(), hist={code:null,rows:null};

  $("#n-estado").innerHTML = ESTADOS.map(e=>`<option value="${e.k}">${e.t}</option>`).join("");
  $("#n-estado").value="fabrica";

  function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(t._h);t._h=setTimeout(()=>t.hidden=true,2600);}
  function fmt(v){ const n=ms(v); if(!n) return "—"; const d=new Date(n); return d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"})+" "+d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}); }
  function hace(v){ const n=ms(v); if(!n) return ""; const m=Math.round((Date.now()-n)/60000); if(m<60) return "hace "+Math.max(m,1)+" min"; const h=Math.round(m/60); if(h<48) return "hace "+h+" h"; return "hace "+Math.round(h/24)+" días"; }
  function showErr(msg){ const e=$("#errBox"); e.textContent=msg; e.hidden=!msg; }
  function dbErr(err){
    console.error(err);
    if(!err) return "No se pudo guardar.";
    if(err.code==="23505") return "Ya existe un barril con ese código.";
    if(err.code==="42501" || /row-level security/i.test(err.message||"")) return "Tenés que ingresar para hacer cambios.";
    if(/fetch|network/i.test(err.message||"")) return "Sin conexión. Revisá internet y probá de nuevo.";
    return "No se pudo guardar: "+(err.message||"error desconocido");
  }
  const logged = () => !!session;
  const DOMINIO = "@barriles.app";
  const toEmail = u => { u=String(u||"").trim().toLowerCase(); return u.includes("@") ? u : u + DOMINIO; };
  const nombre = e => String(e||"").replace(DOMINIO,"");

  // ---------- rutas: ?b=CODIGO (QR) o #CODIGO ----------
  function readRoute(){
    const p=new URLSearchParams(location.search).get("b");
    const h=decodeURIComponent((location.hash||"").replace(/^#/,""));
    const c = p || (/^[A-Za-z0-9-]+$/.test(h) && !["barriles","etiquetas","login"].includes(h) ? h : "");
    if(c){ fichaCode=norm(c); } else { fichaCode=null; if(["barriles","etiquetas","login"].includes(h)) view=h; }
  }
  function go(v){ view=v; fichaCode=null; history.pushState(null,"",BASE+(v==="barriles"?"":"#"+v)); render(); window.scrollTo(0,0); }
  function openFicha(c){ fichaCode=norm(c); history.pushState(null,"",BASE+"?b="+encodeURIComponent(fichaCode)); render(); window.scrollTo(0,0); }
  window.addEventListener("popstate",()=>{ stopScan(); readRoute(); render();});
  document.querySelectorAll("nav.tabs button").forEach(b=>b.addEventListener("click",()=>go(b.dataset.tab)));
  $("#findForm").addEventListener("submit",e=>{e.preventDefault(); const c=norm($("#findInput").value); if(!c) return; openFicha(c); $("#findInput").value="";});

  // ---------- render ----------
  function render(){
    if(!ready) return;
    $("#loading").hidden=true;
    const v = fichaCode ? "ficha" : (view==="etiquetas" && !logged() ? "barriles" : view);
    document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-current", String(v===b.dataset.tab)));
    ["ficha","barriles","etiquetas","login"].forEach(k=>$("#v-"+k).hidden = v!==k);
    document.querySelectorAll("[data-auth]").forEach(el=>el.hidden=!logged());
    $("#btnLogin").hidden=logged(); $("#userBox").hidden=!logged();
    $("#userMail").textContent = session ? nombre(session.user.email) : "";
    const cerv=[...new Set(barriles.map(b=>b.cerveza).filter(Boolean))].sort();
    const lug=[...new Set(["FÁBRICA",...barriles.map(b=>b.cerveceria).filter(Boolean)])].sort();
    $("#dl-cervezas").innerHTML=cerv.map(x=>`<option value="${esc(x)}">`).join("");
    $("#dl-lugares").innerHTML=lug.map(x=>`<option value="${esc(x)}">`).join("");
    if(v==="ficha") renderFicha();
    else if(v==="barriles") renderLista();
    else if(v==="etiquetas") renderEtiquetas();
  }

  const hace_h = h => new Date(Date.now()-h*3600e3).toISOString();
  const DEMO = [
    {codigo:"EJ-101", litros:50, cerveza:"IPA",    cerveceria:"CERVECERÍA EL FARO", estado:"servicio", actualizado:hace_h(2)},
    {codigo:"EJ-102", litros:30, cerveza:"STOUT",  cerveceria:"BAR LA ESQUINA",     estado:"retirar",  actualizado:hace_h(26)},
    {codigo:"EJ-103", litros:20, cerveza:"GOLDEN", cerveceria:"FÁBRICA",            estado:"fabrica",  actualizado:hace_h(5)}
  ];
  function renderLista(){
    const demo=!logged(), list=demo?DEMO:barriles;
    $("#demoNote").hidden=!demo;
    const counts={}; list.forEach(b=>counts[b.estado]=(counts[b.estado]||0)+1);
    $("#summary").innerHTML = ESTADOS.map(e=>`<button type="button" class="sum" data-st="${e.k}" aria-pressed="${fEstado===e.k}"><b>${counts[e.k]||0}</b>${pill(e.k)}</button>`).join("");
    $("#summary").querySelectorAll(".sum").forEach(b=>b.onclick=()=>{fEstado = fEstado===b.dataset.st?null:b.dataset.st; renderLista();});
    const byL={}; list.forEach(b=>{const l=b.cerveceria||"SIN UBICACIÓN"; byL[l]=(byL[l]||0)+1;});
    const ls=Object.entries(byL).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    $("#places").innerHTML = ls.length? ls.map(([l,n])=>`<button type="button" data-l="${esc(l)}" aria-pressed="${fLugar===l}"><span>${esc(l)}</span><span class="n">${n}</span></button>`).join("") : `<p style="margin:0;color:var(--muted);font-size:14px">Todavía no hay barriles ubicados.</p>`;
    $("#places").querySelectorAll("button").forEach(b=>b.onclick=()=>{fLugar = fLugar===b.dataset.l?null:b.dataset.l; renderLista();});
    const q=$("#filtro").value.trim().toLowerCase();
    const rows=list.filter(b=>(!fEstado||b.estado===fEstado)&&(!fLugar||(b.cerveceria||"SIN UBICACIÓN")===fLugar)&&(!q||[b.codigo,b.cerveza,b.cerveceria].join(" ").toLowerCase().includes(q)));
    $("#limpiarFiltros").hidden = !(fEstado||fLugar||q);
    $("#tbody").innerHTML = rows.map(b=>`<tr data-c="${esc(b.codigo)}"${demo?' class="demo"':""}><td class="code">${esc(b.codigo)}<span class="sub">${esc(b.litros||"")} L</span></td><td>${esc(b.cerveza||"—")}</td><td>${esc(b.cerveceria||"—")}</td><td>${pill(b.estado)}</td><td style="white-space:nowrap;color:var(--muted);font-size:13px">${esc(hace(b.actualizado))}</td></tr>`).join("");
    $("#tbody").querySelectorAll("tr").forEach(tr=>tr.onclick=()=> demo ? (toast("Es un ejemplo. Ingresá para ver tus barriles."), $("#btnLogin").click()) : openFicha(tr.dataset.c));
    const em=$("#emptyList");
    if(!list.length){ em.hidden=false; em.innerHTML=`<h3>Todavía no hay barriles</h3><p>${logged()?"Cargá el primero con <b>+ Nuevo barril</b>.":"Ingresá para cargar el primero."}</p>`; }
    else if(!rows.length){ em.hidden=false; em.innerHTML=`<p>Ningún barril coincide con el filtro.</p>`; }
    else em.hidden=true;
  }
  $("#filtro").addEventListener("input",renderLista);
  $("#limpiarFiltros").onclick=()=>{fEstado=null;fLugar=null;$("#filtro").value="";renderLista();};

  $("#btnNuevo").onclick=()=>{ $("#nuevoPanel").hidden=false; $("#n-codigo").focus(); };
  $("#nuevoCancel").onclick=()=>{ $("#nuevoPanel").hidden=true; $("#nuevoErr").textContent=""; };
  $("#nuevoForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const codigo=norm($("#n-codigo").value);
    if(!/^[A-Z0-9-]+$/.test(codigo)){ $("#nuevoErr").textContent="El código solo puede tener letras, números y guiones."; return; }
    if(barriles.some(b=>b.codigo===codigo)){ $("#nuevoErr").textContent="Ya existe un barril con el código "+codigo+"."; return; }
    const d={codigo, litros:Number($("#n-litros").value), cerveza:normL($("#n-cerveza").value), cerveceria:normL($("#n-lugar").value)||"FÁBRICA", estado:$("#n-estado").value, nota:""};
    let {error}=await sb.from("barriles").insert(d);
    if(!error) ({error}=await sb.from("movimientos").insert({codigo, cerveceria:d.cerveceria, cerveza:d.cerveza, estado:d.estado, nota:"Alta del barril"}));
    if(error){ $("#nuevoErr").textContent=dbErr(error); return; }
    $("#nuevoForm").reset(); $("#n-estado").value="fabrica"; $("#n-litros").value="30"; $("#nuevoPanel").hidden=true; $("#nuevoErr").textContent="";
    toast("Barril "+codigo+" guardado"); await load();
  });

  async function loadHist(code){
    hist={code,rows:null};
    const {data,error}= logged()
      ? await sb.from("movimientos").select("*").eq("codigo",code).order("fecha",{ascending:false}).limit(40)
      : await sb.rpc("historial_barril",{c:code});
    if(hist.code!==code) return;
    hist.rows = error ? [] : data;
    if(fichaCode===code) renderFicha();
  }

  const pub={};
  async function loadPub(code){
    pub[code]="cargando";
    const {data,error}=await sb.rpc("ficha_barril",{c:code});
    pub[code] = error ? null : (data&&data[0] ? Object.assign({},data[0],{cerveceria:normL(data[0].cerveceria),cerveza:normL(data[0].cerveza)}) : null);
    if(fichaCode===code) renderFicha();
  }
  function renderFicha(){
    const box=$("#v-ficha");
    if(!logged() && pub[fichaCode]===undefined){ loadPub(fichaCode); }
    if(!logged() && pub[fichaCode]==="cargando"){ box.innerHTML=`<div class="empty"><p>Buscando el barril ${esc(fichaCode)}…</p></div>`; return; }
    const b= logged() ? barriles.find(x=>x.codigo===fichaCode) : pub[fichaCode];
    if(!b){
      box.innerHTML=`<button class="back" type="button" id="fBack">← Todos los barriles</button><div class="panel" style="text-align:center;padding:30px"><h2 class="sec">Barril ${esc(fichaCode)}</h2><p class="lead" style="margin:8px auto 0">No hay ningún barril registrado con ese código.</p></div>`;
      $("#fBack").onclick=()=>go("barriles"); return;
    }
    if(hist.code!==b.codigo) loadHist(b.codigo);
    const rows=hist.code===b.codigo?hist.rows:null;
    const same = box.dataset.code===b.codigo;
    const keep = id => { const el=same && document.getElementById(id); return el?el.value:null; };
    box.dataset.code=b.codigo;
    const draft={lugar:keep("m-lugar"),cerveza:keep("m-cerveza"),estado:keep("m-estado"),nota:keep("m-nota")};
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
        ${logged()?`<div class="panel"><h3 style="font-size:17px;margin-bottom:12px">Registrar movimiento</h3>
          <form id="movForm" class="stack" style="gap:12px">
            ${lastMov?`<button type="button" class="chip" id="mRepeat">↻ Repetir último: <b>${esc(lastMov.cerveceria)}</b> · ${esc(estadoTxt(lastMov.estado))}</button>`:""}
            <div class="grid-form">
              <label class="field"><span class="label">Cervecería / ubicación</span><input id="m-lugar" class="up" list="dl-lugares" value="${esc(draft.lugar??b.cerveceria??"")}" required></label>
              <label class="field"><span class="label">Cerveza</span><input id="m-cerveza" class="up" list="dl-cervezas" value="${esc(draft.cerveza??b.cerveza??"")}"></label>
              <label class="field"><span class="label">Estado</span><select id="m-estado">${ESTADOS.map(e=>`<option value="${e.k}" ${e.k===(draft.estado||b.estado)?"selected":""}>${e.t}</option>`).join("")}</select></label>
            </div>
            <label class="field"><span class="label">Nota (opcional)</span><textarea id="m-nota" placeholder="Ej.: entregado a Juan, lote 0412">${esc(draft.nota||"")}</textarea></label>
            <div class="row"><button class="btn primary" type="submit">Guardar movimiento</button><button class="btn" type="button" id="mScanNext">${ICON_CAM} Escanear otro barril</button><span id="movErr" class="err"></span></div>
          </form></div>`:`<div class="panel"><p style="margin:0">Para registrar un movimiento de este barril, <a href="#login" id="fLogin">ingresá con tu usuario</a>.</p></div>`}
        <div class="panel"><h3 style="font-size:17px;margin-bottom:6px">Historial</h3>
          ${rows===null?`<p style="color:var(--muted);margin:0">Cargando…</p>`:rows.length?`<ul class="hist">${rows.map(h=>`<li><time>${esc(fmt(h.fecha))}</time><div><b>${esc(h.cerveceria||"—")}</b> · ${esc(h.cerveza||"sin cerveza")}<br>${pill(h.estado)}${h.nota?` <span style="color:var(--muted)">${esc(h.nota)}</span>`:""}${h.usuario?`<div class="who">${esc(nombre(h.usuario))}</div>`:""}</div></li>`).join("")}</ul>`:`<p style="color:var(--muted);margin:0">Sin movimientos registrados.</p>`}
        </div>
      </div>`;
    $("#fBack").onclick=()=>go("barriles");
    const fl=$("#fLogin"); if(fl) fl.onclick=e=>{e.preventDefault(); view="login"; fichaReturn=b.codigo; fichaCode=null; render();};
    const rp=$("#mRepeat"); if(rp) rp.onclick=()=>{ $("#m-lugar").value=lastMov.cerveceria; $("#m-estado").value=lastMov.estado; rp.classList.add("on"); };
    const sn=$("#mScanNext"); if(sn) sn.onclick=startScan;
    const mf=$("#movForm");
    if(mf) mf.addEventListener("submit",async e=>{
      e.preventDefault();
      const mov={codigo:b.codigo, cerveceria:normL($("#m-lugar").value), cerveza:normL($("#m-cerveza").value), estado:$("#m-estado").value, nota:$("#m-nota").value.trim()};
      const btn=mf.querySelector("button[type=submit]"); btn.disabled=true;
      let {error}=await sb.from("movimientos").insert(mov);
      if(!error) ({error}=await sb.from("barriles").update({cerveceria:mov.cerveceria, cerveza:mov.cerveza, estado:mov.estado, nota:mov.nota, actualizado:new Date().toISOString()}).eq("codigo",b.codigo));
      btn.disabled=false;
      if(error){ $("#movErr").textContent=dbErr(error); return; }
      lastMov={cerveceria:mov.cerveceria, estado:mov.estado}; try{ sessionStorage.setItem("lastMov",JSON.stringify(lastMov)); }catch(_){}
      box.dataset.code=""; toast("Movimiento guardado · "+b.codigo+" → "+mov.cerveceria);
      hist={code:null,rows:null}; await load();
    });
  }

  // ---------- etiquetas ----------
  const qrUrl = c => BASE + "?b=" + encodeURIComponent(c);
  function renderEtiquetas(){
    const list=barriles;
    $("#emptyLabels").hidden=!!list.length;
    [...sel].forEach(c=>{ if(!list.some(b=>b.codigo===c)) sel.delete(c); });
    $("#labels").innerHTML=list.map(b=>`<div class="lab" data-lab="${esc(b.codigo)}"><input type="checkbox" class="chk" data-c="${esc(b.codigo)}" ${sel.has(b.codigo)?"checked":""} aria-label="Incluir ${esc(b.codigo)}"><div class="q" data-q="${esc(b.codigo)}"></div><div class="c">${esc(b.codigo)}</div><div class="s">${esc(b.litros||"")} L · Escaneá para ver dónde está</div></div>`).join("");
    if(window.QRCode) $("#labels").querySelectorAll("[data-q]").forEach(el=>new QRCode(el,{text:qrUrl(el.dataset.q),width:260,height:260,colorDark:"#000000",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M}));
    $("#labels").querySelectorAll("input[data-c]").forEach(i=>i.onchange=()=>{i.checked?sel.add(i.dataset.c):sel.delete(i.dataset.c); updSel();});
    updSel();
  }
  function updSel(){
    $("#selCount").textContent = sel.size? sel.size+" seleccionadas" : "Ninguna marcada: se imprimen todas";
    $("#selAll").checked = barriles.length>0 && sel.size===barriles.length;
    document.querySelectorAll(".lab").forEach(l=>l.classList.toggle("skip", sel.size>0 && !sel.has(l.dataset.lab)));
  }
  $("#selAll").onchange=e=>{ sel = e.target.checked? new Set(barriles.map(b=>b.codigo)) : new Set(); renderEtiquetas(); };
  $("#btnImprimir").onclick=()=>window.print();

  // ---------- escanear QR ----------
  const ICON_CAM = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 12h8"/></svg>';
  let lastMov=null; try{ lastMov=JSON.parse(sessionStorage.getItem("lastMov")||"null"); }catch(_){}
  let scanStream=null, scanTimer=null, detector=null, jsqrLoading=null;
  function codeFrom(t){
    t=String(t||"").trim();
    try{ const u=new URL(t); const b=u.searchParams.get("b"); if(b) return norm(b); const h=u.hash.replace(/^#/,""); if(/^[A-Za-z0-9-]+$/.test(h)) return norm(h); return null; }catch(_){}
    return /^[A-Za-z0-9-]+$/.test(t) ? norm(t) : null;
  }
  function loadJsQR(){
    if(window.jsQR) return Promise.resolve();
    if(!jsqrLoading) jsqrLoading=new Promise((res,rej)=>{ const sc=document.createElement("script"); sc.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"; sc.onload=res; sc.onerror=rej; document.head.appendChild(sc); });
    return jsqrLoading;
  }
  async function startScan(){
    const ov=$("#scanView"), msg=$("#scanMsg"); ov.hidden=false; msg.textContent="Apuntá la cámara al QR del barril";
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ msg.textContent="Este navegador no permite usar la cámara. Escribí el código en el buscador de arriba."; return; }
    try{
      if("BarcodeDetector" in window && !detector){ const f=await BarcodeDetector.getSupportedFormats(); if(f.includes("qr_code")) detector=new BarcodeDetector({formats:["qr_code"]}); }
    }catch(_){}
    if(!detector){ try{ await loadJsQR(); }catch(_){ msg.textContent="No se pudo cargar el lector. Revisá la conexión."; return; } }
    try{ scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false}); }
    catch(e){ msg.textContent = e&&e.name==="NotAllowedError" ? "La cámara está bloqueada. Permití el acceso a la cámara para esta página en la configuración del navegador." : "No se pudo abrir la cámara."; return; }
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

  // ---------- ingreso ----------
  let fichaReturn=null;
  $("#btnLogin").onclick=()=>{ fichaReturn=fichaCode; fichaCode=null; view="login"; render(); $("#l-mail").focus(); };
  $("#loginCancel").onclick=()=>{ if(fichaReturn){ fichaCode=fichaReturn; fichaReturn=null; render(); } else go("barriles"); };
  $("#loginForm").addEventListener("submit",async e=>{
    e.preventDefault(); $("#loginErr").textContent="";
    const {error}=await sb.auth.signInWithPassword({email:toEmail($("#l-mail").value), password:$("#l-pass").value});
    if(error){ $("#loginErr").textContent = /invalid/i.test(error.message)?"Usuario o contraseña incorrectos.":"No se pudo ingresar: "+error.message; return; }
    $("#loginForm").reset(); toast("Ingresaste");
    if(fichaReturn){ fichaCode=fichaReturn; fichaReturn=null; } else view="barriles";
    render();
  });
  $("#btnLogout").onclick=async()=>{ await sb.auth.signOut(); toast("Sesión cerrada"); if(view==="etiquetas") view="barriles"; render(); };

  // ---------- instalar ----------
  let installEvt=null;
  window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); installEvt=e; $("#btnInstalar").hidden=false; });
  $("#btnInstalar").onclick=async()=>{ if(!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt=null; $("#btnInstalar").hidden=true; };
  window.addEventListener("appinstalled",()=>{ $("#btnInstalar").hidden=true; toast("App instalada"); });
  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));

  // ---------- datos ----------
  let live=null;
  async function load(){
    if(!logged()){ barriles=[]; showErr(""); if(live){ sb.removeChannel(live); live=null; } ready=true; render(); return; }
    if(!live) live=sb.channel("barriles-live").on("postgres_changes",{event:"*",schema:"public",table:"barriles"},()=>{ hist={code:null,rows:null}; load(); }).subscribe();
    const {data,error}=await sb.from("barriles").select("*");
    if(error){ showErr("No se pudieron cargar los barriles. "+(/fetch/i.test(error.message)?"Revisá la conexión a internet.":error.message)); }
    else { showErr(""); barriles=data.map(b=>Object.assign({},b,{cerveceria:normL(b.cerveceria),cerveza:normL(b.cerveza)})).sort((a,b)=>a.codigo.localeCompare(b.codigo,"es",{numeric:true})); }
    ready=true; render();
  }

  async function start(){
    readRoute();
    const cfg=window.APP_CONFIG||{};
    if(!window.supabase || !cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL)){ $("#loading").hidden=true; $("#setup").hidden=false; return; }
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    ({data:{session}}=await sb.auth.getSession());
    sb.auth.onAuthStateChange((ev,s)=>{ const was=!!session; session=s; if(was!==!!s){ hist={code:null,rows:null}; load(); } else render(); });
    await load();
  }
  start();
})();
