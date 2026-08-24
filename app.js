const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PACKAGE_PRICE = { Ekonom: 70, Standart: 95, Full: 120 };
const STATUS_LABELS = { pending:"Növbədə", in_progress:"İşdədir", ready:"Hazırdır", done:"Bağlandı" };
const EXTRA_SERVICES = [
  { name: "Yağ filtri dəyişimi", price: 10 },
  { name: "Hava filtri dəyişimi", price: 12 },
  { name: "Salon filtri dəyişimi", price: 15 },
  { name: "Kompleks filtr dəyişimi", price: 30 },
  { name: "Kompüter diaqnostikası", price: 25 },
  { name: "Əyləc sistemi yoxlaması", price: 20 },
  { name: "Akkumulyator yoxlaması", price: 10 },
  { name: "Antifriz yoxlaması", price: 10 },
  { name: "Şüşə yuyucusu doldurulması", price: 5 }
];

/* ---------- XSS qorunması ---------- */
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- Auth ---------- */
async function initAuth() {
  const { data } = await db.auth.getSession();
  if (data && data.session) enterApp();
  else {
    document.getElementById("loginScreen").classList.remove("hidden");
    document.getElementById("appShell").classList.add("hidden");
  }
}
function enterApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  showView("dashboard");
}
async function login(e) {
  e.preventDefault();
  const { error } = await db.auth.signInWithPassword({
    email: document.getElementById("login_email").value.trim(),
    password: document.getElementById("login_password").value
  });
  if (error) { alert("Giriş xətası: " + error.message); return; }
  enterApp();
}
async function logout() { await db.auth.signOut(); location.reload(); }

/* ---------- Görünüşlər ---------- */
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  const el = document.getElementById("view-" + name);
  if (el) el.classList.remove("hidden");
  document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById("nav-" + name);
  if (btn) btn.classList.add("active");

  if (name === "dashboard") loadDashboard();
  if (name === "customers") loadCustomers();
  if (name === "vehicles") loadVehicles();
  if (name === "requests") loadRequests();
  if (name === "finance") loadFinance();
  if (name === "order") { loadOrderCustomers(); loadOrders(); }
}

document.addEventListener("click", function (e) {
  const item = e.target.closest("#dashboard .item");
  if (!item) return;
  const items = Array.from(document.querySelectorAll("#dashboard .item"));
  if (items.length < 4) return;
  const idx = items.indexOf(item);
  if (idx === 0) showView("customers");
  else if (idx === 1) showView("vehicles");
  else if (idx === 2) showView("order");
  else if (idx === 3) showView("requests");
});

/* ---------- Tarix köməkçiləri ---------- */
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dd;
}
function fmtDateAZ(isoDate) {
  if (!isoDate) return "";
  const p = isoDate.split("-");
  if (p.length !== 3) return isoDate;
  return p[2] + "." + p[1] + "." + p[0];
}
function getPeriodStart(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "day") return today;
  if (period === "week") {
    const day = today.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diff);
    return monday;
  }
  return new Date(today.getFullYear(), today.getMonth(), 1);
}
function inPeriod(dateString, period) {
  if (!dateString) return false;
  const today = fmtDate(new Date());
  const start = fmtDate(getPeriodStart(period));
  if (period === "day") return dateString === today;
  return dateString >= start && dateString <= today;
}

/* ---------- Telefon validasiyası ---------- */
function validatePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 10 || !digits.startsWith("0")) {
    return "Telefon nömrəsi 0 ilə başlamalı və tam 10 rəqəm olmalıdır (məs: 0501234567)";
  }
  return null;
}

/* ---------- Dashboard ---------- */
async function loadDashboard() {
  const box = document.getElementById("dashboard");
  box.innerHTML = '<div class="item"><div class="small">Yüklənir...</div></div>';
  const c = await db.from("customers").select("*", { count: "exact", head: true });
  const v = await db.from("vehicles").select("*", { count: "exact", head: true });
  const o = await db.from("service_orders").select("*", { count: "exact", head: true });
  const q = await db.from("service_requests").select("*", { count: "exact", head: true });
  box.innerHTML =
    '<div class="item"><div class="small">Müştərilər</div><div class="big">' + (c.count || 0) + "</div></div>" +
    '<div class="item"><div class="small">Avtomobillər</div><div class="big">' + (v.count || 0) + "</div></div>" +
    '<div class="item"><div class="small">Sifarişlər</div><div class="big">' + (o.count || 0) + "</div></div>" +
    '<div class="item"><div class="small">Müraciətlər</div><div class="big">' + (q.count || 0) + "</div></div>";
  loadReminders();
}

/* ---------- Xatırlatmalar (yalnız km) ---------- */
let remindersCache = {};
async function loadReminders() {
  const box = document.getElementById("reminders");
  if (!box) return;
  box.innerHTML = '<div class="small">Yüklənir...</div>';
  const { data, error } = await db
    .from("service_orders")
    .select("*, customers(full_name, phone, whatsapp_phone), vehicles(brand, model, plate_number, last_mileage)")
    .order("created_at", { ascending: false });
  if (error) { box.innerHTML = '<div class="error">Xəta: ' + esc(error.message) + "</div>"; return; }

  const latestByVehicle = {};
  (data || []).forEach(function (ord) {
    if (!ord.vehicle_id) return;
    if (!latestByVehicle[ord.vehicle_id]) latestByVehicle[ord.vehicle_id] = ord;
  });

  const dueList = Object.values(latestByVehicle).filter(function (ord) {
    return ord.next_service_km && ord.vehicles && ord.vehicles.last_mileage >= ord.next_service_km - 1000;
  });

  if (dueList.length === 0) {
    box.innerHTML = '<div class="small">Yaxınlaşan xatırlatma yoxdur.</div>';
    return;
  }

  remindersCache = {};
  box.innerHTML = "";
  dueList.forEach(function (ord) {
    remindersCache[ord.id] = ord;
    const vehicleText = ord.vehicles ? esc(ord.vehicles.brand) + " " + esc(ord.vehicles.model) + " (" + esc(ord.vehicles.plate_number || "-") + ")" : "-";
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML =
      '<div class="name">' + esc(ord.customers ? ord.customers.full_name : "-") + "</div>" +
      '<div class="small">' + vehicleText + "</div>" +
      '<div class="small">Son km: ' + esc(ord.vehicles ? ord.vehicles.last_mileage : "-") + "</div>" +
      '<div class="small">Növbəti servis: ' + esc(ord.next_service_km || "-") + " km</div>" +
      '<div class="row" style="margin-top:8px"><button class="btn btn-green" onclick="sendReminder(\'' + ord.id + '\')">Xatırlatma göndər</button></div>';
    box.appendChild(card);
  });
}
function sendReminder(id) {
  const ord = remindersCache[id];
  if (!ord) return;
  const phone = (ord.customers && (ord.customers.whatsapp_phone || ord.customers.phone)) || "";
  const clean = phone.replace(/\D/g, "");
  if (!clean) { alert("Müştərinin WhatsApp nömrəsi yoxdur"); return; }
  const name = ord.customers ? ord.customers.full_name : "";
  const vehicle = ord.vehicles ? ord.vehicles.brand + " " + ord.vehicles.model : "Avtomobiliniz";
  const text = "Salam " + name + ", " + vehicle + " avtomobiliniz üçün yağ dəyişmə vaxtı yaxınlaşır. Son km: " + (ord.vehicles ? ord.vehicles.last_mileage : "-") + ". Tövsiyə olunan növbəti yağ dəyişimi: " + (ord.next_service_km || "-") + " km. Növbə üçün cavab yazın.";
  window.open("https://wa.me/" + clean + "?text=" + encodeURIComponent(text), "_blank");
}

/* ---------- Müştərilər ---------- */
async function loadCustomers() {
  const box = document.getElementById("customers");
  box.innerHTML = '<div class="small">Yüklənir...</div>';
  const { data, error } = await db.from("customers").select("*").order("created_at", { ascending: false });
  if (error) { box.innerHTML = '<div class="error">Xəta: ' + esc(error.message) + "</div>"; return; }
  if (!data || data.length === 0) { box.innerHTML = '<div class="small">Hələ müştəri yoxdur.</div>'; return; }
  box.innerHTML = "";
  data.forEach(function (c) {
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML =
      '<div class="name">' + esc(c.full_name) + "</div>" +
      '<div class="small">Telefon: ' + esc(c.phone || "-") + "</div>" +
      '<div class="small">WhatsApp: ' + esc(c.whatsapp_phone || "-") + "</div>" +
      (c.note ? '<div class="small">' + esc(c.note) + "</div>" : "");
    box.appendChild(card);
  });
}
function toggleCustomerForm() { document.getElementById("customerForm").classList.toggle("hidden"); }
async function addCustomer(e) {
  e.preventDefault();
  const name = document.getElementById("c_name").value.trim();
  const phone = document.getElementById("c_phone").value.trim();
  const whatsapp = document.getElementById("c_whatsapp").value.trim();
  const note = document.getElementById("c_note").value.trim();
  if (!name) { alert("Ad Soyad daxil edin"); return; }
  if (phone) {
    const err = validatePhone(phone);
    if (err) { alert(err); return; }
  }
  const { error } = await db.from("customers").insert([{
    full_name: name, phone: phone || null, whatsapp_phone: whatsapp || null, note: note || null
  }]);
  if (error) { alert("Xəta: " + error.message); return; }
  document.getElementById("customerForm").reset();
  document.getElementById("customerForm").classList.add("hidden");
  loadCustomers(); loadCustomerOptions(); loadDashboard();
}

/* ---------- Avtomobillər ---------- */
async function loadVehicles() {
  const box = document.getElementById("vehicles");
  box.innerHTML = '<div class="small">Yüklənir...</div>';
  const { data, error } = await db.from("vehicles").select("*, customers(full_name)").order("created_at", { ascending: false });
  if (error) { box.innerHTML = '<div class="error">Xəta: ' + esc(error.message) + "</div>"; return; }
  if (!data || data.length === 0) { box.innerHTML = '<div class="small">Hələ avtomobil yoxdur.</div>'; return; }
  box.innerHTML = "";
  data.forEach(function (v) {
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML =
      '<div class="name">' + esc(v.brand || "") + " " + esc(v.model || "") + "</div>" +
      '<div class="small">Nömrə: ' + esc(v.plate_number || "-") + "</div>" +
      '<div class="small">Müştəri: ' + esc((v.customers && v.customers.full_name) || "-") + "</div>" +
      '<div class="small">Son km: ' + esc(v.last_mileage || "-") + "</div>";
    box.appendChild(card);
  });
}
async function loadCustomerOptions() {
  const select = document.getElementById("v_customer");
  const { data, error } = await db.from("customers").select("id, full_name").order("full_name");
  if (error) return;
  select.innerHTML = "";
  (data || []).forEach(function (c) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.full_name;
    select.appendChild(opt);
  });
}
function toggleVehicleForm() { loadCustomerOptions(); document.getElementById("vehicleForm").classList.toggle("hidden"); }
async function addVehicle(e) {
  e.preventDefault();
  const customer_id = document.getElementById("v_customer").value;
  const brand = document.getElementById("v_brand").value.trim();
  const model = document.getElementById("v_model").value.trim();
  const year = parseInt(document.getElementById("v_year").value, 10) || null;
  const plate = document.getElementById("v_plate").value.trim();
  const mileage = parseInt(document.getElementById("v_mileage").value, 10) || null;
  if (!customer_id) { alert("Müştəri seçin"); return; }
  if (!brand) { alert("Marka daxil edin"); return; }
  const { error } = await db.from("vehicles").insert([{
    customer_id: customer_id, brand: brand, model: model || null, year: year,
    plate_number: plate || null, last_mileage: mileage
  }]);
  if (error) { alert("Xəta: " + error.message); return; }
  document.getElementById("vehicleForm").reset();
  document.getElementById("vehicleForm").classList.add("hidden");
  loadVehicles(); loadDashboard();
}

/* ---------- Müraciətlər ---------- */
let requestsCache = {};
async function loadRequests() {
  const box = document.getElementById("requests");
  box.innerHTML = '<div class="small">Yüklənir...</div>';
  const { data, error } = await db.from("service_requests").select("*").order("created_at", { ascending: false });
  if (error) { box.innerHTML = '<div class="error">Xəta: ' + esc(error.message) + "</div>"; return; }
  if (!data || data.length === 0) { box.innerHTML = '<div class="small">Hələ müraciət yoxdur.</div>'; return; }
  requestsCache = {};
  data.forEach(function (r) { requestsCache[r.id] = r; });
  box.innerHTML = "";
  data.forEach(function (r) {
    const card = document.createElement("div");
    card.className = "item";
    const tag = r.status === "converted"
      ? '<span class="tag tag-converted">Sifarişə çevrilib</span>'
      : '<span class="tag tag-new">Yeni</span>';
    const appt = (r.preferred_date || r.preferred_time)
      ? '<div class="small">Növbə: ' + esc(r.preferred_date || "-") + " " + esc(r.preferred_time || "") + "</div>"
      : "";
    card.innerHTML =
      '<div class="name">' + esc(r.full_name) + tag + "</div>" +
      '<div class="small">Telefon: ' + esc(r.phone || "-") + "</div>" +
      '<div class="small">Avtomobil: ' + esc(r.brand || "-") + " " + esc(r.model || "-") + " (" + esc(r.plate_number || "-") + ")</div>" +
      '<div class="small">Km: ' + esc(r.mileage || "-") + " | Paket: " + esc(r.package || "-") + "</div>" +
      appt +
      (r.note ? '<div class="small">Qeyd: ' + esc(r.note) + "</div>" : "") +
      '<div class="row" style="margin-top:8px">' +
      (r.status !== "converted" ? '<button class="btn btn-blue" onclick="convertRequest(\'' + r.id + '\')">Sifarişə çevir</button>' : "") +
      '<button class="btn btn-green" onclick="requestWhatsApp(\'' + r.id + '\')">WhatsApp</button>' +
      '<button class="btn btn-gray" onclick="deleteRequest(\'' + r.id + '\')">Sil</button></div>';
    box.appendChild(card);
  });
}

async function convertRequest(id) {
  const r = requestsCache[id];
  if (!r) return;

  let customer_id = null;
  const { data: existingCustomers } = await db.from("customers").select("id").eq("phone", r.phone).limit(1);
  if (existingCustomers && existingCustomers.length > 0) {
    customer_id = existingCustomers[0].id;
    await db.from("customers").update({ full_name: r.full_name }).eq("id", customer_id);
  } else {
    const { data: newCustomer, error: cErr } = await db.from("customers").insert([{
      full_name: r.full_name, phone: r.phone || null, whatsapp_phone: r.whatsapp_phone || null, note: "Saytdan gələn müraciət"
    }]).select().single();
    if (cErr) { alert("Müştəri xətası: " + cErr.message); return; }
    customer_id = newCustomer.id;
  }

  let vehicle_id = null;
  if (r.plate_number) {
    const { data: existingVehicles } = await db.from("vehicles").select("id").eq("plate_number", r.plate_number).limit(1);
    if (existingVehicles && existingVehicles.length > 0) vehicle_id = existingVehicles[0].id;
  }
  if (!vehicle_id) {
    const { data: newVehicle, error: vErr } = await db.from("vehicles").insert([{
      customer_id: customer_id, brand: r.brand || "Naməlum", model: r.model || "", year: r.year,
      plate_number: r.plate_number || null, last_mileage: r.mileage || null
    }]).select().single();
    if (vErr) { alert("Avtomobil xətası: " + vErr.message); return; }
    vehicle_id = newVehicle.id;
  }

  const next_service_km = (r.mileage || 0) + DEFAULT_INTERVAL_KM;
  const order_number = "S-" + String(Date.now()).slice(-6);

  const { error: oErr } = await db.from("service_orders").insert([{
    customer_id: customer_id,
    vehicle_id: vehicle_id,
    order_number: order_number,
    status: "pending",
    mileage: r.mileage || 0,
    package: r.package || "Standart",
    total_amount: PACKAGE_PRICE[r.package] || 95,
    payment_status: "unpaid",
    note: null,
    customer_note: r.note || null,
    next_service_km: next_service_km,
    appointment_date: r.preferred_date || null,
    appointment_time: r.preferred_time || null,
    started_at: new Date().toISOString()
  }]);
  if (oErr) { alert("Sifariş xətası: " + oErr.message); return; }

  await db.from("service_requests").update({ status: "converted" }).eq("id", id);
  alert("Sifarişə çevrildi: " + order_number);
  loadRequests(); loadOrders(); loadCustomers(); loadVehicles(); loadDashboard();
}

function requestWhatsApp(id) {
  const r = requestsCache[id];
  if (!r) return;
  const clean = (r.whatsapp_phone || r.phone || "").replace(/\D/g, "");
  if (!clean) { alert("WhatsApp nömrəsi yoxdur"); return; }

  const vehicle = (r.brand || "") + " " + (r.model || "");

  let timeText = "";
  if (r.preferred_date) {
    timeText = fmtDateAZ(r.preferred_date);
    if (r.preferred_time) timeText += " " + r.preferred_time;
  }

  let text;
  if (timeText) {
    text = "Salam " + r.full_name + ", Oil Service Mərkəzindən narahat edirik. " +
      vehicle + " avtomobiliniz üçün müraciətiniz qəbul edildi. " +
      "Zəhmət olmasa növbə götürdüyünüz vaxtı (" + timeText + ") təsdiqləmək üçün cavab yazın.";
  } else {
    text = "Salam " + r.full_name + ", Oil Service Mərkəzindən narahat edirik. " +
      vehicle + " avtomobiliniz üçün müraciətiniz qəbul edildi. " +
      "Sizə uyğun vaxtı təsdiqləmək üçün cavab yazın.";
  }

  window.open("https://wa.me/" + clean + "?text=" + encodeURIComponent(text), "_blank");
}

async function deleteRequest(id) {
  if (!confirm("Müraciət silinsin?")) return;
  const { error } = await db.from("service_requests").delete().eq("id", id);
  if (error) { alert("Xəta: " + error.message); return; }
  loadRequests(); loadDashboard();
}

/* ---------- Sifarişlər + Modal ---------- */
let ordersCache = {};
let currentModalOrderId = null;

async function loadOrderCustomers() {
  const select = document.getElementById("o_customer");
  const { data, error } = await db.from("customers").select("id, full_name").order("full_name");
  if (error) return;
  select.innerHTML = "";
  (data || []).forEach(function (c) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.full_name;
    select.appendChild(opt);
  });
  loadOrderVehicles();
}
async function loadOrderVehicles() {
  const customerId = document.getElementById("o_customer").value;
  const select = document.getElementById("o_vehicle");
  select.innerHTML = "";
  if (!customerId) return;
  const { data, error } = await db.from("vehicles").select("id, brand, model, plate_number, last_mileage").eq("customer_id", customerId).order("created_at");
  if (error) return;
  (data || []).forEach(function (v) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = (v.brand || "") + " " + (v.model || "") + " (" + (v.plate_number || "-") + ")";
    opt.dataset.mileage = v.last_mileage || "";
    select.appendChild(opt);
  });
  prefillMileage();
}
function prefillMileage() {
  const select = document.getElementById("o_vehicle");
  const opt = select.selectedOptions[0];
  if (opt && opt.dataset.mileage) document.getElementById("o_mileage").value = opt.dataset.mileage;
}
function toggleOrderForm() {
  const form = document.getElementById("orderForm");
  form.classList.toggle("hidden");
  if (!form.classList.contains("hidden")) loadOrderCustomers();
}
async function addOrder(e) {
  e.preventDefault();
  const customer_id = document.getElementById("o_customer").value;
  const vehicle_id = document.getElementById("o_vehicle").value;
  const mileage = parseInt(document.getElementById("o_mileage").value, 10) || 0;
  const pkg = document.getElementById("o_package").value;
  const amount = parseFloat(document.getElementById("o_amount").value) || PACKAGE_PRICE[pkg] || 0;
  const note = document.getElementById("o_note").value.trim();
  const appt_date = document.getElementById("o_appt_date").value || null;
  const appt_time = document.getElementById("o_appt_time").value.trim() || null;
  if (!customer_id || !vehicle_id) { alert("Müştəri və avtomobil seçin"); return; }
  if (!mileage) { alert("Son km daxil edin"); return; }
  const next_service_km = mileage + DEFAULT_INTERVAL_KM;
  const order_number = "S-" + String(Date.now()).slice(-6);
  const { error } = await db.from("service_orders").insert([{
    customer_id: customer_id, vehicle_id: vehicle_id, order_number: order_number,
    status: "pending", mileage: mileage, package: pkg, total_amount: amount,
    payment_status: "unpaid", note: note || null, customer_note: null,
    next_service_km: next_service_km,
    appointment_date: appt_date, appointment_time: appt_time,
    started_at: new Date().toISOString()
  }]);
  if (error) { alert("Xəta: " + error.message); return; }
  await db.from("vehicles").update({ last_mileage: mileage }).eq("id", vehicle_id);
  document.getElementById("orderForm").reset();
  document.getElementById("orderForm").classList.add("hidden");
  loadOrderCustomers(); loadOrders(); loadDashboard();
  alert("Sifariş yaradıldı: " + order_number);
}

async function loadOrders() {
  const box = document.getElementById("orders");
  box.innerHTML = '<div class="small">Yüklənir...</div>';
  const { data, error } = await db.from("service_orders")
    .select("*, customers(full_name, phone, whatsapp_phone), vehicles(brand, model, plate_number)")
    .order("created_at", { ascending: false });
  if (error) { box.innerHTML = '<div class="error">Xəta: ' + esc(error.message) + "</div>"; return; }
  if (!data || data.length === 0) { box.innerHTML = '<div class="small">Hələ sifariş yoxdur.</div>'; return; }
  ordersCache = {};
  data.forEach(function (o) { ordersCache[o.id] = o; });
  box.innerHTML = "";
  data.forEach(function (o) {
    const card = document.createElement("div");
    card.className = "item order-card";
    card.onclick = function () { openOrderModal(o.id); };
    const vehicleText = o.vehicles ? esc(o.vehicles.brand) + " " + esc(o.vehicles.model) + " (" + esc(o.vehicles.plate_number || "-") + ")" : "-";
    const appt = (o.appointment_date || o.appointment_time)
      ? '<div class="small">Növbə: ' + esc(o.appointment_date || "-") + " " + esc(o.appointment_time || "") + "</div>"
      : "";
    card.innerHTML =
      '<div class="name">' + esc(o.order_number) + " — " + esc(o.customers ? o.customers.full_name : "-") + "</div>" +
      '<div class="small">' + vehicleText + "</div>" +
      '<div class="small">Km: ' + esc(o.mileage || "-") + " | Paket: " + esc(o.package || "-") + "</div>" +
      '<div class="small">Məbləğ: ' + esc(o.total_amount || 0) + " AZN | Ödəniş: " + (o.payment_status === "paid" ? "Ödənilib" : "Ödənilməyib") + "</div>" +
      appt;
    box.appendChild(card);
  });
}

function openOrderModal(id) {
  const o = ordersCache[id];
  if (!o) return;
  currentModalOrderId = id;

  document.getElementById("modalTitle").textContent = o.order_number + " — " + (o.customers ? o.customers.full_name : "-");
  document.getElementById("modalSubtitle").textContent = o.vehicles ? o.vehicles.brand + " " + o.vehicles.model + " (" + (o.vehicles.plate_number || "-") + ")" : "";

  const baseAmount = Number(o.total_amount) || PACKAGE_PRICE[o.package] || 0;
  document.getElementById("m_amount").value = baseAmount;

  document.getElementById("m_status").value = o.status || "pending";
  document.getElementById("m_payment").value = o.payment_status || "unpaid";
  document.getElementById("m_method").value = o.payment_method || "cash";
  document.getElementById("m_note").value = o.note || "";

  const apptLine = document.getElementById("m_appt_line");
  if (o.appointment_date || o.appointment_time) {
    apptLine.textContent = "Növbə: " + (o.appointment_date || "-") + " " + (o.appointment_time || "");
    apptLine.classList.remove("hidden");
  } else {
    apptLine.classList.add("hidden");
  }

  const cnLine = document.getElementById("m_customer_note");
  if (o.customer_note) {
    cnLine.textContent = "Müştərinin qeydi: " + o.customer_note;
    cnLine.classList.remove("hidden");
  } else {
    cnLine.classList.add("hidden");
  }

  buildExtrasPanel(o);
  document.getElementById("extrasPanel").classList.add("hidden");
  togglePaymentMethod();
  document.getElementById("orderModal").classList.remove("hidden");
}
function closeOrderModal() {
  document.getElementById("orderModal").classList.add("hidden");
  currentModalOrderId = null;
}
function togglePaymentMethod() {
  const paid = document.getElementById("m_payment").value === "paid";
  document.getElementById("methodField").style.display = paid ? "block" : "none";
}

function buildExtrasPanel(o) {
  const panel = document.getElementById("extrasPanel");
  const saved = (o.extra_services || "").split("|").filter(Boolean);
  panel.innerHTML = "";
  EXTRA_SERVICES.forEach(function (s) {
    const checked = saved.indexOf(s.name) !== -1;
    const label = document.createElement("label");
    label.innerHTML =
      '<span><input type="checkbox" data-name="' + s.name + '" data-price="' + s.price + '" onchange="onExtraToggle(this)"' + (checked ? " checked" : "") + "> " + esc(s.name) + "</span>" +
      "<strong>+" + s.price + " AZN</strong>";
    panel.appendChild(label);
  });
}
function toggleExtras() {
  document.getElementById("extrasPanel").classList.toggle("hidden");
}
function onExtraToggle(el) {
  const price = parseFloat(el.dataset.price) || 0;
  const amountInput = document.getElementById("m_amount");
  let amount = parseFloat(amountInput.value) || 0;
  if (el.checked) amount += price;
  else amount -= price;
  if (amount < 0) amount = 0;
  amountInput.value = amount;
}

/* ---------- Ətraflı Modal (Müştəri Tarixçəsi) ---------- */
async function openCustomerDetail() {
  const o = ordersCache[currentModalOrderId];
  if (!o || !o.customer_id) return;

  const { data: customer } = await db.from("customers").select("*").eq("id", o.customer_id).single();
  const { data: vehicles } = await db.from("vehicles").select("*").eq("customer_id", o.customer_id);
  const { data: orders } = await db.from("service_orders").select("*").eq("customer_id", o.customer_id).order("created_at", { ascending: false });

  let html = "";
  if (customer) {
    html += '<div class="small">Telefon: ' + esc(customer.phone || "-") + "</div>";
    html += '<div class="small">WhatsApp: ' + esc(customer.whatsapp_phone || "-") + "</div>";
  }

  html += '<h4 class="fin-h">Avtomobillər</h4>';
  if (vehicles && vehicles.length > 0) {
    vehicles.forEach(function (v) {
      html += '<div class="srow-fin"><span>' + esc(v.brand || "") + " " + esc(v.model || "") + " (" + esc(v.plate_number || "-") + ')</span><strong>' + esc(v.last_mileage || "-") + " km</strong></div>";
    });
  } else {
    html += '<div class="small">Avtomobil yoxdur.</div>';
  }

  html += '<h4 class="fin-h">Sifariş və xidmət tarixçəsi</h4>';
  if (orders && orders.length > 0) {
    orders.forEach(function (ord) {
      const extras = (ord.extra_services || "").split("|").filter(Boolean);
      const extrasHtml = extras.map(function (e) { return '<div class="small" style="margin-left:12px">+ ' + esc(e) + "</div>"; }).join("");
      html +=
        '<div class="srow-fin" style="flex-direction:column; align-items:flex-start; gap:4px">' +
          '<div style="display:flex; justify-content:space-between; width:100%">' +
            '<strong>' + esc(ord.order_number) + " • " + esc(ord.created_at ? fmtDate(new Date(ord.created_at)) : "-") + "</strong>" +
            "<span>" + esc(ord.total_amount || 0) + " AZN</span>" +
          "</div>" +
          '<div class="small">Paket: ' + esc(ord.package || "-") + "</div>" +
          extrasHtml +
          '<div class="small">' + esc(STATUS_LABELS[ord.status] || ord.status) + "</div>" +
        "</div>";
    });
  } else {
    html += '<div class="small">Sifariş yoxdur.</div>';
  }

  document.getElementById("detailTitle").textContent = customer ? customer.full_name : "Müştəri";
  document.getElementById("detailContent").innerHTML = html;
  document.getElementById("detailModal").classList.remove("hidden");
}
function closeDetailModal() {
  document.getElementById("detailModal").classList.add("hidden");
}

async function saveOrderModal() {
  if (!currentModalOrderId) return;

  const extras = [];
  document.querySelectorAll("#extrasPanel input:checked").forEach(function (cb) {
    extras.push(cb.dataset.name);
  });

  const update = {
    total_amount: parseFloat(document.getElementById("m_amount").value) || 0,
    status: document.getElementById("m_status").value,
    payment_status: document.getElementById("m_payment").value,
    note: document.getElementById("m_note").value.trim() || null,
    extra_services: extras.join("|") || null
  };

  if (update.payment_status === "paid") {
    update.payment_method = document.getElementById("m_method").value;
    update.finished_at = new Date().toISOString();
  } else {
    update.payment_method = null;
  }

  const { error } = await db.from("service_orders").update(update).eq("id", currentModalOrderId);
  if (error) { alert("Xəta: " + error.message); return; }
  closeOrderModal();
  loadOrders(); loadDashboard(); loadFinance();
}

function modalWhatsApp() {
  const o = ordersCache[currentModalOrderId];
  if (!o) return;
  const phone = (o.customers && (o.customers.whatsapp_phone || o.customers.phone)) || "";
  const clean = phone.replace(/\D/g, "");
  if (!clean) { alert("Müştərinin WhatsApp nömrəsi yoxdur"); return; }
  const name = o.customers ? o.customers.full_name : "";
  const vehicle = o.vehicles ? o.vehicles.brand + " " + o.vehicles.model : "Avtomobiliniz";
  const statusText = STATUS_LABELS[o.status] || o.status;
  const text = "Salam " + name + ", " + vehicle + " avtomobiliniz üçün sifariş statusu: " + statusText + ". Məbləğ: " + (o.total_amount || 0) + " AZN.";
  window.open("https://wa.me/" + clean + "?text=" + encodeURIComponent(text), "_blank");
}

/* ---------- Maliyyə ---------- */
let financePeriod = "day";
let financeData = { income: [], expenses: [] };
async function loadFinance() {
  const [inc, exp] = await Promise.all([
    db.from("service_orders").select("order_number, total_amount, finished_at, payment_status, customers(full_name)").eq("payment_status", "paid"),
    db.from("expenses").select("*")
  ]);
  financeData.income = (inc.data || []).map(function (o) {
    return {
      label: esc(o.order_number) + " — " + esc(o.customers ? o.customers.full_name : "-"),
      amount: Number(o.total_amount || 0),
      date: o.finished_at ? fmtDate(new Date(o.finished_at)) : null
    };
  }).filter(function (x) { return x.date; });
  financeData.expenses = (exp.data || []).map(function (x) {
    return {
      label: esc(x.title) + " (" + esc(x.category || "Digər") + ")",
      amount: Number(x.amount || 0),
      date: x.expense_date || null
    };
  });
  renderFinanceCards(); renderFinanceDetail();
}
function calcPeriod(period) {
  let income = 0, expense = 0;
  financeData.income.forEach(function (x) { if (inPeriod(x.date, period)) income += x.amount; });
  financeData.expenses.forEach(function (x) { if (inPeriod(x.date, period)) expense += x.amount; });
  return { income: income, expense: expense, net: income - expense };
}
function renderFinanceCards() {
  const box = document.getElementById("financeCards");
  const periods = [{ key: "day", label: "Bu gün" }, { key: "week", label: "Bu həftə" }, { key: "month", label: "Bu ay" }];
  box.innerHTML = "";
  periods.forEach(function (p) {
    const c = calcPeriod(p.key);
    const card = document.createElement("div");
    card.className = "item fin-card" + (financePeriod === p.key ? " fin-active" : "");
    card.onclick = function () { selectPeriod(p.key); };
    card.innerHTML =
      '<div class="small">' + p.label + "</div>" +
      '<div class="fin-line g">Gəlir: ' + c.income + " AZN</div>" +
      '<div class="fin-line e">Xərc: ' + c.expense + " AZN</div>" +
      '<div class="fin-line n">Təmiz: ' + c.net + " AZN</div>";
    box.appendChild(card);
  });
}
function selectPeriod(key) { financePeriod = key; renderFinanceCards(); renderFinanceDetail(); }
function renderFinanceDetail() {
  const labels = { day: "Bu gün", week: "Bu həftə", month: "Bu ay" };
  document.getElementById("financeDetailTitle").textContent = "Detal — " + labels[financePeriod];
  const inc = financeData.income.filter(function (x) { return inPeriod(x.date, financePeriod); });
  const exp = financeData.expenses.filter(function (x) { return inPeriod(x.date, financePeriod); });
  const incBox = document.getElementById("financeIncome");
  const expBox = document.getElementById("financeExpense");
  incBox.innerHTML = inc.length === 0 ? '<div class="small">Bu dövrdə gəlir yoxdur.</div>' : "";
  inc.forEach(function (x) { incBox.innerHTML += '<div class="srow-fin"><span>' + x.label + "</span><strong>+" + x.amount + " AZN</strong></div>"; });
  expBox.innerHTML = exp.length === 0 ? '<div class="small">Bu dövrdə xərc yoxdur.</div>' : "";
  exp.forEach(function (x) { expBox.innerHTML += '<div class="srow-fin"><span>' + x.label + '</span><strong class="red">-' + x.amount + " AZN</strong></div>"; });
}
function toggleExpenseForm() {
  const form = document.getElementById("expenseForm");
  if (form.classList.contains("hidden")) document.getElementById("e_date").value = fmtDate(new Date());
  form.classList.toggle("hidden");
}
async function addExpense(e) {
  e.preventDefault();
  const title = document.getElementById("e_title").value.trim();
  const category = document.getElementById("e_category").value;
  const amount = parseFloat(document.getElementById("e_amount").value) || 0;
  const expense_date = document.getElementById("e_date").value || fmtDate(new Date());
  const note = document.getElementById("e_note").value.trim();
  if (!title) { alert("Ad daxil edin"); return; }
  if (!amount) { alert("Məbləğ daxil edin"); return; }
  const { error } = await db.from("expenses").insert([{ title: title, category: category, amount: amount, expense_date: expense_date, note: note || null }]);
  if (error) { alert("Xəta: " + error.message); return; }
  document.getElementById("expenseForm").reset();
  document.getElementById("expenseForm").classList.add("hidden");
  loadFinance();
}

/* ---------- Başlanğıc ---------- */
initAuth();