export const ACTIONS = {
  forward: ['Tiến', ['KeyW', 'ArrowUp']], backward: ['Lùi', ['KeyS', 'ArrowDown']],
  left: ['Trái', ['KeyA', 'ArrowLeft']], right: ['Phải', ['KeyD', 'ArrowRight']],
  jump: ['Nhảy', ['Space']], dash: ['Lướt', ['ShiftLeft', 'ShiftRight']],
  interact: ['Tương tác', ['KeyE']], pulse: ['Tỏa sáng', ['KeyF']], pause: ['Tạm dừng', ['KeyP', 'Escape']],
};

const RESERVED = new Set(['Tab', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Unidentified']);
const isBinding = code => typeof code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(code) && !RESERVED.has(code);

export function defaultBindings() {
  return Object.fromEntries(Object.entries(ACTIONS).map(([action, [, codes]]) => [action, [...codes]]));
}

export function loadBindings(stored) {
  const bindings = defaultBindings();
  for (const action of Object.keys(bindings)) {
    if (Array.isArray(stored?.[action]) && stored[action].length && stored[action].every(isBinding)) bindings[action] = [...stored[action]];
  }
  const all = Object.values(bindings).flat();
  return new Set(all).size === all.length ? bindings : defaultBindings();
}

export function bindingIndex(bindings) {
  return new Map(Object.entries(bindings).flatMap(([action, codes]) => codes.map(code => [code, action])));
}

function keyLabel(code) {
  const labels = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'Shift' };
  return labels[code] ?? code.replace(/^(Key|Digit)/, '');
}

export function bindingLabel(codes) {
  return [...new Set(codes.map(keyLabel))].join(' / ');
}

export function createBindingEditor(container, status, getBindings, setBindings) {
  const buttons = new Map();
  let active = null;
  for (const [action, [label]] of Object.entries(ACTIONS)) {
    const row = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary binding-key';
    button.dataset.action = action;
    button.addEventListener('click', () => {
      active = active === action ? null : action;
      announce(active ? `Nhấn phím mới cho ${label}.` : '');
      render();
    });
    buttons.set(action, button);
    row.append(name, button);
    container.append(row);
  }

  function announce(message, error = false) {
    status.textContent = message;
    status.classList.toggle('warning', error);
  }

  function render() {
    const bindings = getBindings();
    for (const [action, button] of buttons) {
      const label = bindingLabel(bindings[action]);
      button.textContent = active === action ? 'Nhấn phím…' : label;
      button.setAttribute('aria-label', `Đổi phím ${ACTIONS[action][0]} (${label})`);
      button.setAttribute('aria-pressed', String(active === action));
    }
  }

  return {
    render,
    cancel() { active = null; announce(''); render(); },
    reset() { active = null; setBindings(defaultBindings()); announce('Đã khôi phục phím mặc định.'); render(); },
    capture(event) {
      if (!active) return false;
      if (event.code === 'Tab') {
        active = null;
        announce('');
        render();
        return false;
      }
      event.preventDefault();
      if (event.repeat) return true;
      if (!isBinding(event.code) || event.altKey || event.metaKey || event.ctrlKey) {
        announce('Hãy chọn một phím đơn có thể gán.', true);
        return true;
      }
      const bindings = getBindings();
      const conflict = bindingIndex(bindings).get(event.code);
      if (conflict && conflict !== active) {
        announce(`Phím ${keyLabel(event.code)} đang dùng cho ${ACTIONS[conflict][0]}.`, true);
        return true;
      }
      const action = active;
      active = null;
      setBindings({ ...bindings, [action]: [event.code] });
      announce(`Đã gán ${keyLabel(event.code)} cho ${ACTIONS[action][0]}.`);
      render();
      return true;
    },
  };
}
