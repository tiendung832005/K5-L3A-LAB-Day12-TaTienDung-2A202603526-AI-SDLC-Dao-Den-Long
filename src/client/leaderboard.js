import { normalizeName, PLAYER_NAME } from '../shared/leaderboard.js';

const endpoint = '/api/leaderboard';
const format = new Intl.NumberFormat('vi-VN');

export function showScoreForm(slot, result) {
  const template = document.getElementById('score-form-template');
  const form = template.content.firstElementChild.cloneNode(true);
  const input = form.elements.name;
  const submit = form.querySelector('button');
  const status = form.querySelector('[role=status]');
  slot.replaceChildren(form);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const name = normalizeName(input.value);
    if (!PLAYER_NAME.test(name)) {
      input.setAttribute('aria-invalid', 'true');
      status.textContent = 'Tên phải có 3–12 chữ cái, chữ số, dấu gạch dưới hoặc gạch ngang.';
      status.classList.add('warning');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    status.classList.remove('warning');
    submit.disabled = true;
    status.textContent = 'Đang lưu điểm…';
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...result }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      input.readOnly = true;
      status.textContent = 'Đã lưu điểm.';
    } catch {
      status.textContent = 'Chưa lưu được điểm. Hãy chạy game qua launcher rồi thử lại.';
      status.classList.add('warning');
      submit.disabled = false;
    }
  });
}

export async function loadLeaderboard() {
  const status = document.getElementById('leaderboard-status');
  const table = document.getElementById('leaderboard-table');
  const rows = document.getElementById('leaderboard-entries');
  table.hidden = true;
  status.textContent = 'Đang tải bảng xếp hạng…';
  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { entries } = await response.json();
    const elements = entries.map((entry, index) => {
      const row = document.createElement('tr');
      for (const value of [index + 1, entry.name, `${entry.nights_won}/3`, format.format(entry.score)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    });
    rows.replaceChildren(...elements);
    table.hidden = !elements.length;
    status.textContent = elements.length ? '' : 'Chưa có điểm được lưu.';
  } catch {
    status.textContent = 'Chưa tải được bảng xếp hạng. Hãy chạy game qua launcher.';
  }
}
