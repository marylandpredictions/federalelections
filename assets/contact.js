(function () {
  const form = document.querySelector("[data-contact-form]");
  const status = document.querySelector("[data-contact-status]");
  if (!form || !status) return;

  function setStatus(message, type) {
    status.textContent = message;
    status.dataset.status = type;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    const payload = Object.fromEntries(new FormData(form).entries());

    submit.disabled = true;
    setStatus("Sending message...", "pending");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Message could not be sent.");
      }

      form.reset();
      setStatus(result.emailed ? "Message sent." : "Message saved. Email delivery is not configured yet.", result.emailed ? "success" : "pending");
    } catch (error) {
      setStatus(error.message || "Message could not be sent.", "error");
    } finally {
      submit.disabled = false;
    }
  });
})();
