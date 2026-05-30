// Global State
let currentLang = localStorage.getItem('appLang') || 'th';
let translations = {};
let touristSpots = [];
let schedules = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadTranslations();
  applyTranslations();
  initLanguageSwitcher();
  initDarkMode();
  initAnimations();
  initMobileNav();
});

// Load Data
async function loadTranslations() {
  try {
    const res = await fetch('./assets/data/translations.json');
    translations = await res.json();
  } catch (error) {
    console.error("Error loading translations:", error);
  }
}

async function loadTouristSpots() {
  if (touristSpots.length > 0) return touristSpots;
  try {
    const res = await fetch('./assets/data/tourist_spots.json');
    touristSpots = await res.json();
    return touristSpots;
  } catch (error) {
    console.error("Error loading spots:", error);
    return [];
  }
}

async function loadSchedules() {
  if (schedules.length > 0) return schedules;
  try {
    const res = await fetch('./assets/data/schedules.json');
    schedules = await res.json();
    return schedules;
  } catch (error) {
    console.error("Error loading schedules:", error);
    return [];
  }
}

// Language Handling
function initLanguageSwitcher() {
  const langBtns = document.querySelectorAll('.lang-btn');
  langBtns.forEach(btn => {
    // Set initial state
    if (btn.dataset.lang === currentLang) {
      btn.classList.add('bg-primary', 'text-white');
    }

    btn.addEventListener('click', (e) => {
      const lang = e.currentTarget.dataset.lang;
      setLanguage(lang);
    });
  });
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('appLang', lang);
  applyTranslations();
  
  // Update active state on buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    if(btn.dataset.lang === lang) {
      btn.classList.add('bg-primary', 'text-white');
      btn.classList.remove('bg-gray-200', 'text-gray-700');
    } else {
      btn.classList.remove('bg-primary', 'text-white');
      btn.classList.add('bg-gray-200', 'text-gray-700');
    }
  });

  // Dispatch custom event for pages to update dynamic content
  window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
}

function applyTranslations() {
  const elements = document.querySelectorAll('[data-i18n]');
  if (!translations[currentLang]) return;
  
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[currentLang][key]) {
      if (el.tagName === 'INPUT' && el.type === 'text') {
        el.placeholder = translations[currentLang][key];
      } else if (el.tagName === 'OPTION') {
        el.textContent = translations[currentLang][key];
      } else {
        el.innerHTML = translations[currentLang][key];
      }
    }
  });
}

function getTranslation(key) {
  if (translations[currentLang] && translations[currentLang][key]) {
    return translations[currentLang][key];
  }
  return key;
}

/** แปลง path รูปใน JSON ให้ชี้ไฟล์ในโฟลเดอร์ place/ ถูกต้อง */
function resolveSpotImageUrl(imagePath) {
  if (!imagePath || typeof imagePath !== 'string') return '';
  let path = imagePath.trim().replace(/\\/g, '/');
  path = path.replace(/^\/?plaace\//i, 'place/');
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith('./') && !path.startsWith('../')) {
    path = `./${path.replace(/^\//, '')}`;
  }
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return path;
  }
}

function applySpotImage(imgEl, spot) {
  if (!imgEl || !spot) return;
  const url = resolveSpotImageUrl(spot.image);
  imgEl.alt = spot[`name_${currentLang}`] || spot.name_th || 'สถานที่ท่องเที่ยว';
  imgEl.classList.remove('spot-image-failed');
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.removeAttribute('src');
    imgEl.classList.add('spot-image-failed');
    console.warn('โหลดรูปไม่สำเร็จ:', spot.image, '→', url);
  };
  imgEl.src = url;
}

// Dark Mode Handling
function initDarkMode() {
  const toggleBtns = document.querySelectorAll('.dark-mode-toggle');
  const isDark = localStorage.getItem('darkMode') === 'true';
  
  if (isDark) {
    document.body.classList.add('dark-mode');
  }

  toggleBtns.forEach(btn => {
    if (isDark) btn.innerHTML = '<i class="fas fa-sun"></i>';
    
    btn.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isNowDark = document.body.classList.contains('dark-mode');
      localStorage.setItem('darkMode', isNowDark);
      
      toggleBtns.forEach(b => {
        b.innerHTML = isNowDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
      });
    });
  });
}

// Intersection Observer for Animations
function initAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-fade-in');
        entry.target.style.opacity = 1;
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.anim-hidden').forEach(el => {
    el.style.opacity = 0;
    observer.observe(el);
  });
}

// Mobile Nav Active State
function initMobileNav() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.mobile-nav-link');
  
  navLinks.forEach(link => {
    const href = link.getAttribute('href').replace('./', '');
    if (currentPath.endsWith(href) || (currentPath.endsWith('/') && href === 'index.html')) {
      link.classList.add('text-primary');
      link.classList.remove('text-gray-500');
    } else {
      link.classList.remove('text-primary');
      link.classList.add('text-gray-500');
    }
  });
}
