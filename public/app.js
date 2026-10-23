const $ = selector => document.querySelector(selector);
const state = { user: null, today: null, records: [], requests: [], employees: [], page: 'overview', month: new Date(), timer: null };
const dateFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const shortDateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtTime = value => value ? timeFmt.format(new Date(value)) : '—';
const fmtHours = mins => `${Math.floor((mins || 0) / 60)}h ${String((mins || 0) % 60).padStart(2,'0')}m`;
const localDateString = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
const prettyDate = date => dateFmt.format(new Date(`${date}T12:00:00+05:30`));
let toastTimer;
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !url.includes('/auth/login')) { showLogin(); throw new Error(data.error || 'Please log in again.'); }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3600);
}
function showLogin() {
  clearInterval(state.timer); $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); state.user = null;
}
function showApp(user) {
  state.user = user; $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  $('#profileName').textContent = user.name; $('#profileRole').textContent = user.role; $('#avatar').textContent = user.name.charAt(0).toUpperCase();
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', user.role !== 'admin'));
  $('#todayDate').textContent = dateFmt.format(new Date());
  state.page = 'overview'; navigate('overview'); refreshAll();
  clearInterval(state.timer); state.timer = setInterval(updateClock, 1000);
}
function navigate(page) {
  if (page === 'team' && state.user?.role !== 'admin') return;
  state.page = page;
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('hidden', el.id !== `page-${page}`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  const titles = { overview: 'Overview', calendar: 'Attendance calendar', requests: 'Missed punches', team: 'Team & shifts' };
  $('#pageTitle').textContent = titles[page] || 'Overview';
  $('#topEyebrow').textContent = state.user?.role === 'admin' ? 'ADMIN WORKSPACE' : 'YOUR WORKSPACE';
  renderPage();
}
async function refreshAll() {
  try {
    const [today, records, requests] = await Promise.all([api('/api/attendance/today'), api('/api/attendance'), api('/api/punch-requests')]);
    state.today = today; state.records = records.attendance; state.requests = requests.requests;
    if (state.user.role === 'admin') { const employees = await api('/api/admin/employees'); state.employees = employees.employees; }
    updatePendingBadge(); renderPage();
  } catch (err) { toast(err.message, true); }
}
function updatePendingBadge() {
  const count = state.requests.filter(r => r.status === 'pending').length;
  const badge = $('#pendingBadge'); badge.textContent = count; badge.classList.toggle('hidden', !count);
}
function updateClock() {
  const el = $('#liveClock'); if (el) el.textContent = new Intl.DateTimeFormat('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true, timeZone:'Asia/Kolkata' }).format(new Date());
}
function attendanceStatus(record) {
  if (!record) return '<span class="pill">Not clocked in</span>';
  if (record.status === 'late') return '<span class="pill amber">Late arrival</span>';
  if (record.clockIn && !record.clockOut) return '<span class="pill green">Working now</span>';
  if (record.clockIn && record.clockOut) return '<span class="pill green">Completed</span>';
  return '<span class="pill">Incomplete</span>';
}
function renderPage() {
  if (!state.user) return;
  if (state.page === 'overview') renderOverview();
  if (state.page === 'calendar') renderCalendar();
  if (state.page === 'requests') renderRequests();
  if (state.page === 'team') renderTeam();
}
function renderOverview() {
  const { attendance, shift, date } = state.today || {};
  const total = state.records.filter(r => r.clockIn && r.clockOut).reduce((sum,r) => sum + r.workingMinutes, 0);
  const presentDays = state.records.filter(r => r.clockIn).length;
  const admin = state.user.role === 'admin';
  const ownRecord = attendance || null;
  const clockAction = ownRecord?.clockIn && !ownRecord?.clockOut
    ? `<button id="clockOutBtn" class="button primary">Clock out <span>↗</span></button>`
    : ownRecord?.clockOut ? `<button class="button secondary" disabled>Day completed ✓</button>`
    : `<button id="clockInBtn" class="button primary">Clock in <span>↗</span></button>`;
  $('#page-overview').innerHTML = `
    <div class="welcome-row"><div><h2>${admin ? `Welcome back, ${esc(state.user.name.split(' ')[0])}.` : `Hello, ${esc(state.user.name.split(' ')[0])}.`}</h2><p>${admin ? 'Here is the attendance picture for today.' : 'Ready when you are. Keep your day on track.'}</p></div>${attendanceStatus(ownRecord)}</div>
    <div class="dashboard-grid">
      <div>
        <div class="clock-card"><div class="clock-top"><p class="eyebrow">TODAY · ${esc(date || localDateString())}</p><span class="pill">Live clock</span></div><div id="liveClock" class="clock-time">--:--:--</div><div class="clock-date">${esc(dateFmt.format(new Date()))}</div><div class="clock-actions">${clockAction}<button id="missedPunchBtn" class="button outline">Request a correction</button></div><div class="shift-line"><span>Assigned shift</span><strong>${esc(shift?.start || state.user.shift.start)} – ${esc(shift?.end || state.user.shift.end)}</strong></div></div>
        <div class="metric-grid"><div class="metric"><div class="metric-label">Today's hours</div><div class="metric-value">${fmtHours(ownRecord?.workingMinutes || (ownRecord?.clockIn && !ownRecord?.clockOut ? Math.max(0, Math.floor((Date.now() - new Date(ownRecord.clockIn))/60000)) : 0))}</div><div class="metric-note">${ownRecord?.clockIn && !ownRecord?.clockOut ? 'Live session' : 'Net recorded time'}</div></div><div class="metric"><div class="metric-label">Days clocked in</div><div class="metric-value">${presentDays}</div><div class="metric-note">Records available</div></div><div class="metric"><div class="metric-label">Total hours</div><div class="metric-value">${Math.floor(total/60)}<small style="font:500 11px 'DM Sans';letter-spacing:0">h ${total%60}m</small></div><div class="metric-note">Completed sessions</div></div></div>
      </div>
      <div class="card"><div class="card-header"><div><h3>${admin ? 'Needs your attention' : 'Recent activity'}</h3><p>${admin ? 'Pending requests for review' : 'Your latest attendance records'}</p></div><span class="pill">${admin ? state.requests.filter(r=>r.status==='pending').length : state.records.length}</span></div><div class="simple-list">${admin ? recentPendingMarkup() : recentActivityMarkup()}</div><button class="button outline full section-spacer" id="viewRequestsBtn">${admin ? 'Review requests' : 'View attendance history'} <span>→</span></button></div>
    </div>
    ${admin ? `<div class="card section-spacer"><div class="card-header"><div><h3>Today's team</h3><p>Employee check-in status</p></div><button class="button outline" data-go="team">Manage shifts →</button></div>${teamAttendanceTable()}</div>` : ''}`;
  updateClock();
  $('#clockInBtn')?.addEventListener('click', async () => { try { await api('/api/attendance/clock-in', { method:'POST', body:'{}' }); toast('Clocked in. Have a good workday.'); await refreshAll(); } catch(e) { toast(e.message,true); } });
  $('#clockOutBtn')?.addEventListener('click', async () => { if (!confirm('Clock out for today?')) return; try { await api('/api/attendance/clock-out', { method:'POST', body:'{}' }); toast('Clocked out. Your hours have been recorded.'); await refreshAll(); } catch(e) { toast(e.message,true); } });
  $('#missedPunchBtn')?.addEventListener('click', () => openPunchModal());
  $('#viewRequestsBtn')?.addEventListener('click', () => navigate(admin ? 'requests' : 'calendar'));
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.go)));
}
function recentPendingMarkup() {
  const items = state.requests.filter(r=>r.status==='pending').slice(0,4);
  if (!items.length) return '<div class="empty-state"><strong>All caught up</strong>No pending punch requests.</div>';
  return items.map(r=>`<div class="list-row"><div class="row-icon">↗</div><div class="row-main"><strong>${esc(r.employee?.name || 'Employee')} · ${r.punchType==='clockIn'?'Clock in':'Clock out'}</strong><span>${esc(r.date)} · ${esc(r.reason)}</span></div><div class="row-end"><span class="pill amber">Pending</span><small>${fmtTime(r.requestedTime)}</small></div></div>`).join('');
}
function recentActivityMarkup() {
  const items = state.records.slice(0,4);
  if (!items.length) return '<div class="empty-state"><strong>No attendance yet</strong>Your clock-in records will appear here.</div>';
  return items.map(r=>`<div class="list-row"><div class="row-icon">◷</div><div class="row-main"><strong>${esc(prettyDate(r.date))}</strong><span>${fmtTime(r.clockIn)} – ${fmtTime(r.clockOut)}</span></div><div class="row-end"><strong>${r.clockOut?fmtHours(r.workingMinutes):'In progress'}</strong><small>${esc(r.status)}</small></div></div>`).join('');
}
function teamAttendanceTable() {
  if (!state.employees.length) return '<div class="empty-state">No employees added yet.</div>';
  const today = localDateString();
  const rows = state.employees.map(emp=>{
    const rec=state.records.find(r=>r.employee?.id===emp.id&&r.date===today);
    return `<tr><td><strong>${esc(emp.name)}</strong><br><span class="muted">${esc(emp.email)}</span></td><td>${rec?fmtTime(rec.clockIn):'—'}</td><td>${rec?fmtTime(rec.clockOut):'—'}</td><td>${rec?attendanceStatus(rec):'<span class="pill">Not clocked in</span>'}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Clock in</th><th>Clock out</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderCalendar() {
  const year=state.month.getFullYear(), month=state.month.getMonth();
  const monthName=new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(state.month);
  const first=new Date(year,month,1), startDay=first.getDay(), days=new Date(year,month+1,0).getDate();
  const today=localDateString();
  const byDate=new Map(state.records.map(r=>[`${r.employee?.id||state.user.id}:${r.date}`,r]));
  let cells='';
  for(let i=0;i<42;i++){
    const dayNum=i-startDay+1; const dateObj=new Date(year,month,dayNum); const inMonth=dateObj.getMonth()===month; const key=localDateString(dateObj);
    const rec=byDate.get(`${state.user.id}:${key}`);
    let status=''; if(rec) status=`<span class="day-status ${rec.status==='late'?'late':rec.clockOut?'present':'incomplete'}">${rec.status==='late'?'Late':rec.clockOut?'Present':'Incomplete'}</span>`;
    cells+=`<div class="calendar-day ${inMonth?'':'outside'} ${key===today?'today':''}"><span class="day-number">${dateObj.getDate()}</span>${inMonth?status:''}${rec&&rec.clockIn?`<span style="font-size:8px;color:#8b968f">${esc(fmtTime(rec.clockIn))}</span>`:''}</div>`;
  }
  const admin=state.user.role==='admin';
  $('#page-calendar').innerHTML=`<div class="welcome-row"><div><h2>Attendance at a glance</h2><p>${admin?'Viewing your own attendance. Team records are available in the admin overview.':'Your recorded workdays, all in one place.'}</p></div><span class="pill green">${state.records.filter(r=>r.clockIn).length} days recorded</span></div><div class="card"><div class="calendar-toolbar"><div class="month-control"><button id="prevMonth" aria-label="Previous month">←</button><strong>${esc(monthName)}</strong><button id="nextMonth" aria-label="Next month">→</button></div><button id="thisMonth" class="button outline">Today</button></div><div class="calendar-grid">${['SUN','MON','TUE','WED','THU','FRI','SAT'].map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}${cells}</div><div class="legend"><span><i></i> Present</span><span><i class="late-dot"></i> Late</span><span><i class="miss-dot"></i> Incomplete session</span></div></div><div class="card section-spacer"><div class="card-header"><div><h3>Attendance history</h3><p>Most recent records first</p></div><span class="pill">${state.records.length} records</span></div>${historyTable(state.records)}</div>`;
  $('#prevMonth').onclick=()=>{state.month=new Date(year,month-1,1);renderCalendar()}; $('#nextMonth').onclick=()=>{state.month=new Date(year,month+1,1);renderCalendar()}; $('#thisMonth').onclick=()=>{state.month=new Date();renderCalendar()};
}
function historyTable(records) {
  if (!records.length) return '<div class="empty-state"><strong>No records yet</strong>Clock in to start building your attendance history.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Working time</th><th>Status</th></tr></thead><tbody>${records.slice(0,100).map(r=>`<tr><td><strong>${esc(prettyDate(r.date))}</strong></td><td>${fmtTime(r.clockIn)}</td><td>${fmtTime(r.clockOut)}</td><td>${r.clockOut?fmtHours(r.workingMinutes):'—'}</td><td>${attendanceStatus(r)}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderRequests() {
  const admin=state.user.role==='admin';
  const requests=state.requests;
  $('#page-requests').innerHTML=`<div class="welcome-row"><div><h2>${admin?'Punch requests':'Need to fix a missed punch?'}</h2><p>${admin?'Review employee corrections before changing official attendance.':'Submit the time you missed and explain what happened.'}</p></div>${!admin?'<button id="newPunchRequest" class="button primary">+ New request</button>':''}</div><div class="card"><div class="card-header"><div><h3>${admin?'Requests for review':'Your requests'}</h3><p>${admin?'Approval updates the attendance record.':'You can track the status of each correction.'}</p></div><span class="pill ${requests.some(r=>r.status==='pending')?'amber':'green'}">${requests.filter(r=>r.status==='pending').length} pending</span></div>${requests.length?`<div class="table-wrap"><table><thead><tr>${admin?'<th>Employee</th>':''}<th>Date</th><th>Missing punch</th><th>Requested time</th><th>Reason</th><th>Status</th>${admin?'<th>Action</th>':''}</tr></thead><tbody>${requests.map(r=>`<tr>${admin?`<td><strong>${esc(r.employee?.name||'Employee')}</strong><br><span class="muted">${esc(r.employee?.email||'')}</span></td>`:''}<td>${esc(r.date)}</td><td>${r.punchType==='clockIn'?'Clock in':'Clock out'}</td><td>${fmtTime(r.requestedTime)}</td><td class="request-reason">${esc(r.reason)}</td><td><span class="pill ${r.status==='pending'?'amber':r.status==='approved'?'green':'red'}">${esc(r.status)}</span>${r.reviewNote?`<br><small class="muted">${esc(r.reviewNote)}</small>`:''}</td>${admin?`<td>${r.status==='pending'?`<div class="request-actions"><button class="button secondary" data-review="approved" data-id="${r._id}">Approve</button><button class="button danger" data-review="rejected" data-id="${r._id}">Reject</button></div>`:'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><strong>No punch requests</strong>There is nothing to review right now.</div>'}</div>`;
  $('#newPunchRequest')?.addEventListener('click',openPunchModal);
  document.querySelectorAll('[data-review]').forEach(btn=>btn.addEventListener('click',()=>reviewRequest(btn.dataset.id,btn.dataset.review)));
}
async function reviewRequest(id, decision) {
  let reviewNote='';
  if(decision==='rejected') { reviewNote=prompt('Reason for rejecting this request (optional):') ?? null; if(reviewNote===null)return; }
  try { await api(`/api/punch-requests/${id}/review`,{method:'PATCH',body:JSON.stringify({decision,reviewNote})}); toast(`Request ${decision}.`); await refreshAll(); } catch(e){toast(e.message,true)}
}
function renderTeam() {
  if(state.user.role!=='admin')return;
  $('#page-team').innerHTML=`<div class="welcome-row"><div><h2>Team & shifts</h2><p>Manage employee accounts and their scheduled hours.</p></div><button id="addEmployeeBtn" class="button primary">+ Add employee</button></div><div class="team-grid"><div class="card"><div class="card-header"><div><h3>Employees</h3><p>${state.employees.length} active team members</p></div></div><div class="employee-list">${state.employees.length?state.employees.map(emp=>`<div class="employee-card"><div class="avatar">${esc(emp.name.charAt(0).toUpperCase())}</div><div class="profile-copy"><strong>${esc(emp.name)}</strong><span>${esc(emp.email)}</span></div><div class="employee-shift"><span class="pill">${esc(emp.shift.start)}–${esc(emp.shift.end)}</span><button class="button outline" data-edit-shift="${emp.id}">Edit shift</button></div></div>`).join(''):'<div class="empty-state"><strong>No employees yet</strong>Add your first employee to get started.</div>'}</div></div><div class="card"><div class="card-header"><div><h3>Add an employee</h3><p>Create a login with employee-level permissions.</p></div></div><form id="employeeForm" class="stack"><label>Full name<input class="field" name="name" required maxlength="100" placeholder="Employee name"></label><label>Work email<input class="field" name="email" type="email" required placeholder="name@company.com"></label><label>Temporary password<input class="field" name="password" type="password" minlength="10" required placeholder="At least 10 characters"></label><button class="button primary full" type="submit">Create employee</button></form><p class="tiny muted">Share the credentials securely. A password-reset flow can be added later.</p></div></div>`;
  $('#addEmployeeBtn').onclick=()=>$('#employeeForm input[name="name"]').focus();
  $('#employeeForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/admin/employees',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});toast('Employee account created.');await refreshAll();navigate('team')}catch(err){toast(err.message,true)}};
  document.querySelectorAll('[data-edit-shift]').forEach(btn=>btn.onclick=()=>{const emp=state.employees.find(e=>e.id===btn.dataset.editShift);openShiftModal(emp)});
}
function openModal(title, subtitle, content, onSubmit) {
  const root=$('#modalRoot'); root.innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="icon-button" id="closeModal" aria-label="Close">✕</button></div>${content}</section></div>`;
  const close=()=>root.innerHTML=''; $('#closeModal').onclick=close; root.querySelector('.modal-backdrop').addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))close()});
  const form=root.querySelector('form'); if(form)form.onsubmit=async e=>{e.preventDefault();try{await onSubmit(new FormData(form));close()}catch(err){toast(err.message,true)}};
}
function openPunchModal() {
  const today=localDateString();
  openModal('Request a missed punch','Your admin will review this before attendance is changed.',`<form class="stack"><label>Date<input class="field" name="date" type="date" max="${today}" value="${today}" required></label><label>Missing punch<select class="field-select" name="punchType" required><option value="clockIn">Forgot to clock in</option><option value="clockOut">Forgot to clock out</option></select></label><label>Time you intended to record<input class="field" name="requestedTime" type="datetime-local" max="${new Date(Date.now()+5*60000).toISOString().slice(0,16)}" required></label><label>What happened?<textarea class="field-textarea" name="reason" maxlength="500" placeholder="Briefly explain why the punch was missed…" required></textarea></label><div class="modal-actions"><button type="button" class="button outline" id="cancelModal">Cancel</button><button class="button primary" type="submit">Send request</button></div></form>`,async form=>{
    const body=Object.fromEntries(form); const parsed=new Date(body.requestedTime); if(!body.requestedTime)throw new Error('Please select the requested time.'); body.requestedTime=parsed.toISOString();
    await api('/api/punch-requests',{method:'POST',body:JSON.stringify(body)});toast('Correction request submitted.');await refreshAll();
  });
  $('#cancelModal').onclick=()=>$('#modalRoot').innerHTML='';
}
function openShiftModal(emp) {
  openModal('Edit shift',`Update scheduled hours for ${emp.name}.`,`<form class="stack"><label>Shift starts<input class="field" name="start" type="time" value="${esc(emp.shift.start)}" required></label><label>Shift ends<input class="field" name="end" type="time" value="${esc(emp.shift.end)}" required></label><label>Break duration (minutes)<input class="field" name="breakMinutes" type="number" min="0" max="300" step="5" value="${Number(emp.shift.breakMinutes)||0}" required></label><div class="modal-actions"><button type="button" id="cancelModal" class="button outline">Cancel</button><button type="submit" class="button primary">Save shift</button></div></form>`,async form=>{await api(`/api/admin/employees/${emp.id}/shift`,{method:'PATCH',body:JSON.stringify(Object.fromEntries(form))});toast('Shift updated.');await refreshAll();navigate('team')});
  $('#cancelModal').onclick=()=>$('#modalRoot').innerHTML='';
}
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=new FormData(e.currentTarget);$('#loginError').textContent='';const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Signing in…';
  try{const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(form))});e.currentTarget.reset();showApp(data.user)}catch(err){$('#loginError').textContent=err.message}finally{button.disabled=false;button.innerHTML='Sign in <span>↗</span>'}
});
$('#logoutButton').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'})}catch{}showLogin()});
$('#navigation').addEventListener('click',e=>{const btn=e.target.closest('[data-page]');if(btn)navigate(btn.dataset.page)});
(async()=>{try{const data=await api('/api/auth/me');showApp(data.user)}catch{showLogin()}})();
