// ==================== SCROLL ANIMATIONS ====================
        function initScrollAnimations() {
            const revealEls = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-stagger');
            // Immediately reveal elements already in the viewport
            revealEls.forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    el.classList.add('visible');
                }
            });
            // Observe for elements that will scroll into view later
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                    }
                });
            }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
            revealEls.forEach(el => {
                if (!el.classList.contains('visible')) observer.observe(el);
            });
        }

        // ==================== NAV SCROLL ====================
        window.addEventListener('scroll', () => {
            const nav = document.getElementById('navbar');
            const scrollTop = document.getElementById('scrollTop');
            if (window.scrollY > 100) nav.classList.add('scrolled');
            else nav.classList.remove('scrolled');
            if (window.scrollY > 500) scrollTop.classList.add('visible');
            else scrollTop.classList.remove('visible');
        }, { passive: true });

        function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
        function toggleMobileMenu() {
            var nav = document.getElementById('mobileNav');
            var btn = document.querySelector('.mobile-menu-btn');
            nav.classList.toggle('active');
            btn.classList.toggle('open');
            if (nav.classList.contains('active')) {
                nav.style.display = 'block';
                requestAnimationFrame(function() { nav.style.maxHeight = '500px'; nav.style.padding = '1rem 2rem'; });
            } else {
                nav.style.maxHeight = '0'; nav.style.padding = '0 2rem';
                setTimeout(function() { if (!nav.classList.contains('active')) nav.style.display = 'none'; }, 300);
            }
        }
        // ==================== TIMELINE ====================
        function showTimelineDetail(step) {
            document.querySelectorAll('.timeline-step').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.timeline-detail').forEach(d => d.classList.remove('active'));
            document.querySelectorAll('.timeline-step')[step-1].classList.add('active');
            document.getElementById('detail' + step).classList.add('active');
        }

        // Calculate dates
        function calculateTimeline() {
            const today = new Date();
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            document.getElementById('startDate').textContent = today.getDate() + ' ' + months[today.getMonth()];
            
            const minWeeks = 12, maxWeeks = 24;
            const minDate = new Date(today.getTime() + minWeeks * 7 * 24 * 60 * 60 * 1000);
            const maxDate = new Date(today.getTime() + maxWeeks * 7 * 24 * 60 * 60 * 1000);
            document.getElementById('endDate').textContent = months[minDate.getMonth()] + ' - ' + months[maxDate.getMonth()] + ' ' + maxDate.getFullYear();
        }

        // ==================== FAQ ====================
        function toggleFaq(el) {
            const item = el.parentElement;
            item.classList.toggle('open');
        }

        function filterFaq(category, btn) {
            document.querySelectorAll('.faq-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.faq-item').forEach(item => {
                if (category === 'all' || item.dataset.category === category) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
            });
        }

        // ==================== APPOINTMENT BOOKING ====================
        function showApptError(message) {
            var el = document.getElementById('apptError');
            if (!el) return;
            el.textContent = message || '';
            el.classList.toggle('is-visible', !!message);
        }
        function apptDateIsWeekday(value) {
            if (!value) return false;
            const day = new Date(value + 'T00:00:00').getDay();
            return day >= 1 && day <= 5;
        }
        function guardApptDate() {
            const input = document.getElementById('apptDate');
            if (!input || !input.value || apptDateIsWeekday(input.value)) return true;
            input.value = '';
            showApptError('Please choose a weekday. The showroom is open Monday to Friday, 10am to 3pm.');
            return false;
        }
        async function submitAppointment() {
            const btn = document.getElementById('apptSubmit');
            const name = document.getElementById('apptName').value.trim();
            const email = document.getElementById('apptEmail').value.trim();
            const phone = document.getElementById('apptPhone').value.trim();
            const type = document.getElementById('apptType').value;
            const date = document.getElementById('apptDate').value;
            const time = document.getElementById('apptTime').value;
            const notes = document.getElementById('apptNotes').value.trim();

            if (!name || !email || !date) {
                showApptError('Please fill in your name, email, and preferred date.');
                return;
            }
            if (!apptDateIsWeekday(date)) {
                showApptError('Please choose a weekday. The showroom is open Monday to Friday, 10am to 3pm.');
                return;
            }
            showApptError('');

            btn.disabled = true;
            btn.innerHTML = '<svg viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Sending...';

            try {
                const res = await fetch('/api/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        channel: type === 'phone' ? 'call' : 'appointment',
                        name, email, phone,
                        sub_type: type,
                        source_page: '/',
                        message: notes || null,
                        notes: notes || null,
                        appointment_type: type,
                        appointment_date: date,
                        appointment_time: time,
                        appointment_at: new Date(`${date}T${time}:00`).toISOString(),
                        appointment_kind: type,
                        attribution: (window.SMUpgrades && window.SMUpgrades.getAttribution) ? window.SMUpgrades.getAttribution() : null,
                    }),
                });
                const result = await res.json();
                if (result.ok) {
                    // Tracking contract: docs/TRACKING.md (sm_lead_submit).
                    try {
                        window.dataLayer = window.dataLayer || [];
                        window.dataLayer.push({
                            event: 'sm_lead_submit',
                            form_id: 'apptFormFields',
                            enquiry_type: type || null
                        });
                    } catch (e) { /* tracking must never break the form */ }
                    document.getElementById('apptFormFields').style.display = 'none';
                    document.getElementById('apptSuccess').classList.add('show');
                } else {
                    throw new Error(result.error || 'Failed to submit');
                }
            } catch (err) {
                showApptError('Something went wrong. Please try again or call us on 020 3835 2548.');
                btn.disabled = false;
                btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Request Appointment';
            }
        }

        // ==================== SUPABASE CONFIG ====================
        const SUPABASE_URL = window.SM_SUPABASE.url;
        const SM_ORG_ID = '3770972d-1bbd-417b-b413-297e844db285';
        const SUPABASE_ANON_KEY = window.SM_SUPABASE.key;
        const SUPABASE_HEADERS = window.SM_SUPABASE.headers();

        async function supabaseFetch(table, params) {
            const url = new URL(SUPABASE_URL + ['','rest','v1',''].join('/') + table);
            Object.entries(params || {}).forEach(function(entry) { url.searchParams.set(entry[0], entry[1]); });
            const res = await fetch(url.toString(), { headers: SUPABASE_HEADERS });
            if (!res.ok) throw new Error('Supabase query failed: ' + res.status);
            return res.json();
        }

        function homepageEsc(value) {
            return String(value == null ? '' : value).replace(/[&<>"']/g, function(char) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
            });
        }

        function homepageCategoryImg(url, name) {
            var alt = homepageEsc(name);
            var fallback = homepageEsc(url);
            var sized = url;
            if (url.indexOf('/object/public/') !== -1) {
                sized = url.replace('/object/public/', '/render/image/public/') + (url.indexOf('?') === -1 ? '?' : '&') + 'width=640&quality=68&resize=contain';
            }
            return '<img src="' + homepageEsc(sized) + '" alt="' + alt + '" width="640" height="640" loading="lazy" decoding="async" data-fallback="' + fallback + '" onerror="this.onerror=null;this.src=this.dataset.fallback">';
        }

        function homepageImageUrl(value) {
            if (typeof value !== 'string' || value.length > 2048) return '';
            var offHost = ['', 'storage', 'v1'].join('/');
            var offRest = ['', 'rest', 'v1'].join('/');
            if (value.indexOf(offHost) === 0 || value.indexOf(offRest) === 0) {
                return String(SUPABASE_URL || '').replace(/\/$/, '') + value;
            }
            if (value.startsWith('/')) return value;
            try {
                var url = new URL(value);
                return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
            } catch (e) { return ''; }
        }

        // ==================== LOAD HOMEPAGE PHOTOS ====================
        async function loadHomepagePhotos() {
            try {
                const [categories, products] = await Promise.all([
                    supabaseFetch('product_categories', { select: '*', is_active: 'eq.true', order: 'display_order' }),
                    supabaseFetch('products', { select: '*,product_categories(name,slug)', organization_id: 'eq.' + SM_ORG_ID, is_active: 'eq.true', is_listed: 'eq.true', category_id: 'not.is.null', order: 'display_order' })
                ]);

                // Build a map of category slug -> first product with an image
                var categoryImageMap = {};
                var categoryMinPrice = {};
                products.forEach(function(p) {
                    if (p.product_categories && p.product_categories.slug) {
                        var slug = p.product_categories.slug;
                        if (p.image_url && !categoryImageMap[slug]) {
                            categoryImageMap[slug] = p;
                        }
                        if (p.base_price && (!categoryMinPrice[slug] || p.base_price < categoryMinPrice[slug])) {
                            categoryMinPrice[slug] = p.base_price;
                        }
                    }
                });

                // Populate category cards
                var grid = document.getElementById('categoriesGrid');
                if (grid) {
                    var html = '';
                    categories.forEach(function(cat) {
                        var product = categoryImageMap[cat.slug];
                        var imageUrl = product ? homepageImageUrl(product.image_url) : '';
                        var imageHtml = imageUrl
                            ? homepageCategoryImg(imageUrl, cat.name)
                            : '<div style="width:100%;height:100%;background:linear-gradient(145deg,var(--sm-color-bg-panel-quiet),var(--sm-color-bg-panel));"></div>';
                        var hasGuidePrice = Boolean(categoryMinPrice[cat.slug]);
                        var price = hasGuidePrice
                            ? 'From £' + Number(categoryMinPrice[cat.slug]).toLocaleString()
                            : homepageEsc(cat.description || '');
                        html += '<a href="/memorials?type=' + encodeURIComponent(cat.slug || '') + '" class="category-card">'
                            + '<div class="category-image">' + imageHtml + '</div>'
                            + '<div class="category-info"><h3>' + homepageEsc(cat.name) + '</h3><p>' + price + '</p>'
                            + (hasGuidePrice ? '<p class="guide-price-note">Cemetery permit fees are extra and vary by cemetery.</p>' : '') + '</div>'
                            + '</a>';
                    });
                    await yieldToMain();
                    grid.innerHTML = html;
                }

                // Hero image is a hard-coded recent installation (Gioiosa family kerb set);
                // see the <img> in the hero markup. No dynamic override.

                // Populate about image with a different product photo
                var aboutEl = document.getElementById('aboutImage');
                if (aboutEl) {
                    var aboutProduct = products.find(function(p) { return p.image_url && p.product_categories && p.product_categories.slug === 'kerb-sets'; })
                        || products.filter(function(p) { return p.image_url; })[1]
                        || products.find(function(p) { return p.image_url; });
                    var aboutImageUrl = aboutProduct ? homepageImageUrl(aboutProduct.image_url) : '';
                    if (aboutProduct && aboutImageUrl) {
                        var aboutImage = document.createElement('img');
                        aboutImage.src = aboutImageUrl;
                        aboutImage.alt = aboutProduct.name || 'Memorial craftsmanship';
                        aboutImage.loading = 'lazy';
                        aboutEl.replaceChildren(aboutImage);
                    }
                }

                // Re-trigger scroll animations for dynamically added content
                initScrollAnimations();
            } catch (err) {
                console.error('Failed to load homepage photos:', err);
            }
        }

        // ==================== RECENT INSTALLATIONS ====================
        // Local-path entries (starting with `/`) are real on-site installation
        // photos; everything else is a stock product render served from the
        // public Supabase product-images bucket.
        const INSTALLATIONS = [
            { image: '/images/installed/gioiosa-family-kerb-set.webp',      customer: 'The Gioiosa Family',         cemetery: 'Recent installation' },
            { image: '/images/installed/smith-family-memorial.webp',        customer: 'The Smith Family',           cemetery: 'Recent installation' },
            { image: '/images/installed/dawkins-cook-family-memorial.webp', customer: 'The Dawkins & Cook Family',  cemetery: 'Recent installation' },
            { image: 'lawn-headstone.jpg',                 customer: 'The Abood Family',           cemetery: 'New Southgate Cemetery' },
            { image: 'kerb-set-with-vase.png',             customer: 'The McKay Family',           cemetery: 'Hendon Cemetery' },
            { image: 'peon-top-classic.png',               customer: 'The Rivera Cordoba Family',  cemetery: 'East Finchley Cemetery' },
            { image: 'wave-memorial-with-doves.png',       customer: 'The Maunders Family',        cemetery: 'Edmonton Cemetery' },
            { image: 'square-top-contemporary.png',        customer: 'The Rafi Family',            cemetery: 'Eternal Gardens Muslim Cemetery' },
            { image: 'single-heart-on-base.png',           customer: 'The Boughton Family',        cemetery: 'St Pancras & Islington Cemetery' },
            { image: 'kerb-set.jpg',                       customer: 'The Clarke Family',          cemetery: 'Highgate Cemetery' },
            { image: 'open-book-on-plinth.png',            customer: 'The Carter Family',          cemetery: 'Lambeth Cemetery' },
            { image: 'polished-desk-tablet.png',           customer: 'The Rider Family',           cemetery: 'Enfield Crematorium' },
            { image: 'tapered-churchyard-memorial.png',    customer: 'The Adamson Family',         cemetery: 'All Saints Churchyard, Edmonton' }
        ];

        async function initInstallations() {
            const track = document.getElementById('installationsTrack');
            const marquee = document.getElementById('installationsMarquee');
            const prevBtn = document.getElementById('installPrev');
            const nextBtn = document.getElementById('installNext');
            if (!track || !marquee) return;

            // Resized product images via Supabase image transforms (originals untouched).
            // Falls back to the original file if the render URL fails.
            function smRender(url, w) {
                return url.replace(['','storage','v1','object','public',''].join('/'), ['','storage','v1','render','image','public',''].join('/')) + '?width=' + w + '&quality=70&resize=contain';
            }
            function smIsBucketImg(url) { return new RegExp('/' + ['storage','v1','object','public','product-images'].join('/') + '/[^?]+$').test(String(url || '')); }
            function smImgAttrs(url, sizes, escFn) {
                var e = escFn || function(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); };
                if (/^\/images\/installed\/[a-z0-9-]+\.webp$/.test(url)) {
                    var stem = url.replace(/\.webp$/, '');
                    return 'src="' + e(stem + '-600w.webp') + '" srcset="' + e(stem + '-480w.webp') + ' 480w, ' + e(stem + '-600w.webp') + ' 600w, ' + e(stem + '-900w.webp')
                        + ' 900w" sizes="(max-width: 640px) 280px, 320px"';
                }
                if (!smIsBucketImg(url)) return 'src="' + e(url) + '"';
                return 'src="' + e(smRender(url, 800)) + '" srcset="' + [400, 800, 1200].map(function(w) { return e(smRender(url, w)) + ' ' + w + 'w'; }).join(', ')
                        + '" sizes="' + e(sizes) + '" data-fallback="' + e(url) + '" onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.dataset.fallback"';
            }
            function smSetImg(img, url, sizes) {
                if (!smIsBucketImg(url)) { img.removeAttribute('srcset'); img.src = url; return; }
                img.onerror = function() { img.onerror = null; img.removeAttribute('srcset'); img.src = url; };
                img.sizes = sizes;
                img.srcset = [400, 800, 1200].map(function(w) { return smRender(url, w) + ' ' + w + 'w'; }).join(', ');
                img.src = smRender(url, 800);
            }
            const SUPA_PUB = 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/';
            const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
            const pin = '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
            const imgAttrs = image => image.startsWith('/') ? smImgAttrs(image, '320px', esc) : smImgAttrs(SUPA_PUB + encodeURIComponent(image), '320px', esc);
            const resolveSrc = image => image.startsWith('/') ? image : (SUPA_PUB + encodeURIComponent(image));
            const card = ({ image, customer, cemetery }) =>
                '<article class="install-card" aria-roledescription="slide">'
                +   '<div class="install-image">'
                +     '<img ' + imgAttrs(image) + ' alt="' + esc(customer) + ' memorial" loading="lazy" fetchpriority="low" decoding="async" draggable="false" width="320" height="240">'
                +   '</div>'
                +   '<div class="install-info">'
                +     '<p class="install-customer">' + esc(customer) + '</p>'
                +     '<p class="install-cemetery">' + pin + esc(cemetery) + '</p>'
                +   '</div>'
                + '</article>';

            const html = INSTALLATIONS.map(card).join('');
            await yieldToMain();
            track.innerHTML = html + html;

            const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
            let offset = 0, singleWidth = 0, last = performance.now();
            let onscreen = true, dragging = false, idleResumeAt = 0;

            const measure = () => { singleWidth = track.scrollWidth / 2; };
            measure();
            window.addEventListener('resize', measure);
            // Re-measure once images load (their intrinsic size may shift layout)
            track.querySelectorAll('img').forEach(img => img.addEventListener('load', measure, { once: true }));

            // Only run the frame loop while the strip is on screen and the tab is
            // visible. It used to run every frame from load, which kept the phone
            // main thread busy while the hero photo was trying to paint.
            let looping = false;
            const startLoop = () => {
                if (looping || !onscreen || document.hidden) return;
                looping = true; last = performance.now();
                requestAnimationFrame(tick);
            };
            onscreen = false;
            new IntersectionObserver(entries => { onscreen = entries[0].isIntersecting; startLoop(); }, { threshold: 0.05 }).observe(marquee);
            document.addEventListener('visibilitychange', () => { last = performance.now(); startLoop(); });

            const wrap = () => {
                if (!singleWidth) return;
                if (offset >= singleWidth) offset -= singleWidth;
                if (offset < 0) offset += singleWidth;
            };

            function tick(now) {
                const dt = Math.min(64, now - last); last = now;
                const idle = now > idleResumeAt;
                if (!reduceMotion && !dragging && idle && onscreen && !document.hidden) {
                    offset += (30 * dt) / 1000;
                }
                wrap();
                track.style.transform = 'translate3d(' + (-offset) + 'px,0,0)';
                if (!onscreen || document.hidden) { looping = false; return; }
                requestAnimationFrame(tick);
            }

            // Drag with pointer events
            let startX = 0, startOffset = 0, moved = 0, activePointer = null;
            track.addEventListener('pointerdown', e => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                dragging = true; moved = 0; startX = e.clientX; startOffset = offset; activePointer = e.pointerId;
                marquee.classList.add('dragging');
                try { track.setPointerCapture(e.pointerId); } catch (_) {}
            });
            track.addEventListener('pointermove', e => {
                if (!dragging || e.pointerId !== activePointer) return;
                const dx = e.clientX - startX;
                moved = Math.max(moved, Math.abs(dx));
                offset = startOffset - dx;
            });
            const endDrag = e => {
                if (!dragging || e.pointerId !== activePointer) return;
                dragging = false; activePointer = null;
                marquee.classList.remove('dragging');
                idleResumeAt = performance.now() + 2500;
                try { track.releasePointerCapture(e.pointerId); } catch (_) {}
            };
            track.addEventListener('pointerup', endDrag);
            track.addEventListener('pointercancel', endDrag);
            // Suppress click-through after a real drag
            track.addEventListener('click', e => { if (moved > 5) { e.preventDefault(); e.stopPropagation(); } }, true);
            // Stop browser image-drag fully
            track.addEventListener('dragstart', e => e.preventDefault());

            // Smooth nudge for buttons + arrow keys
            function nudge(dir) {
                const first = track.firstElementChild;
                const cardW = first ? first.getBoundingClientRect().width + 24 : 320;
                const start = offset, target = offset + dir * cardW, t0 = performance.now(), dur = 350;
                idleResumeAt = performance.now() + 2500;
                (function step(now) {
                    const k = Math.min(1, (now - t0) / dur);
                    const eased = 1 - Math.pow(1 - k, 3);
                    offset = start + (target - start) * eased;
                    if (k < 1) requestAnimationFrame(step);
                })(t0);
            }
            if (prevBtn) prevBtn.addEventListener('click', () => nudge(-1));
            if (nextBtn) nextBtn.addEventListener('click', () => nudge(1));
            marquee.addEventListener('keydown', e => {
                if (e.key === 'ArrowLeft')  { nudge(-1); e.preventDefault(); }
                if (e.key === 'ArrowRight') { nudge( 1); e.preventDefault(); }
            });
        }

        // ==================== HASH ANCHOR (post-load re-scroll) ====================
        // The homepage has sections above the anchor targets whose contents are
        // populated asynchronously (categoriesGrid via Supabase, the about
        // image, lazy-loaded imagery). The browser's initial scroll to
        // location.hash happens before those layout shifts, which leaves
        // visitors landing in the wrong place. After the dynamic content
        // settles, re-scroll to the requested anchor.
        function scrollToInitialHash() {
            const hash = location.hash;
            if (!hash || hash.length < 2) return;
            let target;
            try { target = document.querySelector(hash); } catch (_) { return; }
            if (!target) return;
            target.scrollIntoView({ block: 'start' });
        }

        function yieldToMain() {
            return new Promise(function (resolve) {
                var scheduler = window.scheduler;
                if (scheduler && typeof scheduler.yield === 'function') scheduler.yield().then(resolve);
                else setTimeout(resolve, 0);
            });
        }

        // ==================== INIT ====================
        document.addEventListener('DOMContentLoaded', () => {
            initScrollAnimations();
            calculateTimeline();
            const photosPromise = loadHomepagePhotos();
            // The marquee builds a second copy of every card. Yield first so
            // that work is not one long task with the rest of startup.
            yieldToMain().then(initInstallations);
            // Set min date for appointment to tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const dateInput = document.getElementById('apptDate');
            if (dateInput) dateInput.min = tomorrow.toISOString().split('T')[0];

            if (location.hash && location.hash.length > 1) {
                // Re-scroll once the categories/about content is in the DOM…
                Promise.resolve(photosPromise).catch(() => {}).then(() => {
                    requestAnimationFrame(() => requestAnimationFrame(scrollToInitialHash));
                });
                // …and again once every image has finished loading, to absorb
                // any remaining layout shift from late-decoding imagery.
                window.addEventListener('load', () => {
                    requestAnimationFrame(scrollToInitialHash);
                }, { once: true });
            }
        });
