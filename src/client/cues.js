export function createCues(canvas, badgeList, arrowList) {
  const markers = Object.fromEntries(['shade', 'wind', 'countdown', 'fuel'].map(name => {
    const badge = document.createElement('span');
    badge.className = 'visual-cue warning';
    badge.hidden = true;
    const arrow = document.createElement('div');
    arrow.className = 'cue-arrow';
    arrow.hidden = true;
    arrow.dataset.cue = name;
    const icon = document.createElement('span');
    icon.textContent = '↑';
    arrow.append(icon);
    badgeList.append(badge);
    arrowList.append(arrow);
    return [name, { badge, arrow, icon }];
  }));
  let latestShade;
  let shadeUntil = 0;

  function render(state, scene, { seconds, windWarning, lowFuel }) {
    const used = [];
    function cue(name, message, marker) {
      const { badge, arrow, icon } = markers[name];
      badge.hidden = !message;
      arrow.hidden = !marker;
      if (!message || !marker) return;
      if (badge.textContent !== message) badge.textContent = message;
      let { x, y } = marker;
      while (used.some(position => Math.hypot(position.x - x, position.y - y) < 31)) {
        x -= Math.sin(marker.angle) * 32;
        y += Math.cos(marker.angle) * 32;
      }
      used.push({ x, y });
      arrow.style.left = `${x}px`;
      arrow.style.top = `${y}px`;
      icon.style.transform = `rotate(${marker.angle}rad)`;
    }
    const shade = state.sim_tick < shadeUntil && latestShade;
    const radians = state.wind.dir_deg * Math.PI / 180;
    const incoming = {
      x: state.player.x - Math.cos(radians) * 22,
      y: state.player.y + 1.5,
      z: state.player.z - Math.sin(radians) * 22,
    };
    const urgent = seconds > 0 && seconds <= 10;
    cue('countdown', urgent && '10 giây cuối giờ', urgent && { x: canvas.clientWidth / 2, y: Math.min(124, canvas.clientHeight / 4), angle: 0 });
    cue('shade', shade && 'Bóng Mực xuất hiện', shade && scene.projectMarker({ ...shade, y: shade.y + 1 }, true));
    cue('wind', windWarning && 'Gió mạnh sắp thổi', windWarning && scene.projectMarker(incoming, true));
    cue('fuel', lowFuel && `${lowFuel.id} sắp cạn dầu`, lowFuel && scene.projectMarker({ ...lowFuel, y: lowFuel.y + 2.5 }, true));
  }

  return {
    render,
    spawn(shade, tick) { latestShade = shade; shadeUntil = tick + 240; },
    reset() { latestShade = undefined; shadeUntil = 0; },
  };
}
