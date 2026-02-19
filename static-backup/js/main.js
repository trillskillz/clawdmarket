// === CONFIG ===
// Set your launch date here (UTC)
const LAUNCH_DATE = new Date('2026-04-20T00:00:00Z');

// === COUNTDOWN TIMER ===
function updateCountdown() {
  const now = new Date();
  const diff = LAUNCH_DATE - now;

  if (diff <= 0) {
    document.getElementById('cd-days').textContent = '🚀';
    document.getElementById('cd-hours').textContent = 'LIVE';
    document.getElementById('cd-mins').textContent = 'NOW';
    document.getElementById('cd-secs').textContent = '🪙';
    document.querySelector('.countdown-label-top').textContent = '$CLAWDCOIN IS LIVE';
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);

  document.getElementById('cd-days').textContent = String(days).padStart(2, '0');
  document.getElementById('cd-hours').textContent = String(hours).padStart(2, '0');
  document.getElementById('cd-mins').textContent = String(mins).padStart(2, '0');
  document.getElementById('cd-secs').textContent = String(secs).padStart(2, '0');
}

setInterval(updateCountdown, 1000);
updateCountdown();

// === ANIMATED COUNTERS ===
function animateCounter(id, target, prefix = '', suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 2000;
  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(eased * target);
    el.textContent = prefix + current.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Trigger counters when hero stats come into view
const heroStats = document.querySelector('.hero-stats');
let countersStarted = false;

if (heroStats) {
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !countersStarted) {
      countersStarted = true;
      animateCounter('agentCount', 247);
      animateCounter('tradeCount', 1893);
      animateCounter('volumeCount', 84750, '$');
    }
  }, { threshold: 0.5 });
  observer.observe(heroStats);
}

// === SMOOTH SCROLL ===
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (href === '#') return;
    e.preventDefault();
    const target = document.querySelector(href);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});

// === CHAIN SELECTOR ===
document.querySelectorAll('.chain-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chain-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// === SWAP ICON ===
document.querySelector('.trade-swap-icon')?.addEventListener('click', () => {
  const sendSelect = document.getElementById('sendToken');
  const recvSelect = document.getElementById('receiveToken');
  if (sendSelect && recvSelect) {
    const tmp = sendSelect.value;
    sendSelect.value = recvSelect.value;
    recvSelect.value = tmp;
  }
});

// === WAITLIST ===
document.getElementById('waitlistBtn')?.addEventListener('click', () => {
  const email = document.getElementById('waitlistEmail')?.value;
  if (email && email.includes('@')) {
    alert('🐾 You\'re on the list! We\'ll notify ' + email + ' when $CLAWDCOIN launches.');
    document.getElementById('waitlistEmail').value = '';
    // Increment the counter for fun
    const countEl = document.getElementById('waitlistCount');
    if (countEl) {
      const current = parseInt(countEl.textContent.replace(/,/g, ''));
      countEl.textContent = (current + 1).toLocaleString();
    }
  } else {
    alert('Please enter a valid email address.');
  }
});

// === SCROLL ANIMATIONS ===
const animateOnScroll = () => {
  const elements = document.querySelectorAll('.step-card, .trade-card, .token-card, .vision-card, .bankr-feat');
  elements.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight - 80) {
      el.style.opacity = '1';
      el.style.transform = el.style.transform || 'translateY(0)';
    }
  });
};

// Initial styles for scroll animation
document.querySelectorAll('.step-card, .trade-card, .token-card, .vision-card, .bankr-feat').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
});

window.addEventListener('scroll', animateOnScroll);
window.addEventListener('load', animateOnScroll);
