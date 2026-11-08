/* Draft mockups for Arin. This file does nothing unless the page URL
   has ?mock=a1 (or a2, b1, b2, c1, c2, d1, d2, e1, e2, e3, f1, f2). */
(function () {
  var mock = new URLSearchParams(location.search).get("mock");
  var known = {
    a1: 1, a2: 1, b1: 1, b2: 1, c1: 1, c2: 1,
    d1: 1, d2: 1, e1: 1, e2: 1, e3: 1, f1: 1, f2: 1
  };
  if (!known[mock]) return;

  document.documentElement.classList.add("sm-mock", "sm-mock-" + mock);

  if (mock === "a2") {
    var logo = document.querySelector("footer .footer-logo");
    if (logo) {
      logo.textContent = "";
      var img = document.createElement("img");
      img.src = "/images/brand/logo/sears-melvin-stacked-soft-bronze.svg";
      img.alt = "Sears Melvin Memorials";
      img.width = 240;
      img.height = 61;
      logo.appendChild(img);
    }
  }

  if (mock === "b2") {
    var contact = document.querySelector("footer .footer-contact");
    if (contact) {
      var sep = document.createElement("span");
      sep.className = "footer-contact-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "·";
      var address = document.createElement("span");
      address.className = "sm-mock-address";
      address.textContent = "1 The Market Place, Falloden Way, NW11 6LB";
      contact.appendChild(sep);
      contact.appendChild(address);
    }
  }

  if (mock === "c2") {
    var links = document.querySelector("footer .footer-links");
    var showroom = document.querySelector("footer .footer-contact");
    if (showroom && showroom.parentNode) {
      var visit = document.createElement("p");
      visit.className = "sm-mock-heading";
      visit.textContent = "Visit our Finchley showroom";
      showroom.parentNode.insertBefore(visit, showroom);
    }
    if (links && links.parentNode) {
      var explore = document.createElement("p");
      explore.className = "sm-mock-heading";
      explore.textContent = "Explore";
      links.parentNode.insertBefore(explore, links);
    }
  }

  if (mock === "e3") {
    var menu = document.querySelector("#navbar .mobile-menu-btn");
    if (menu) {
      var phone = document.createElement("a");
      phone.className = "sm-mock-phone";
      phone.href = "tel:+442038352548";
      phone.setAttribute("aria-label", "Call 020 3835 2548");
      phone.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>';
      menu.parentNode.insertBefore(phone, menu);
    }
  }

  if (mock === "f2") {
    var bar = document.createElement("nav");
    bar.className = "sm-mock-bar";
    bar.setAttribute("aria-label", "Call or get a quote");
    bar.innerHTML = '<a class="sm-mock-call" href="tel:+442038352548">Call</a><a class="sm-mock-quote" href="/contact">Get a quote</a>';
    document.body.appendChild(bar);
  }
})();
