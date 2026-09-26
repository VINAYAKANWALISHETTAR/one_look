/**
 * Auth UI — signup, login and the lock screen (passcode + biometric).
 *
 * Local-only in Phase 1: no backend, no database, nothing leaves the device.
 */

import { el, clear, toast, FACE_SVG, GOOGLE_SVG } from "./ui.js";
import * as auth from "../services/auth-service.js";
import * as biometric from "./biometric.js";
import * as google from "../services/google-auth-service.js";

function field(label, attrs) {
  const input = el("input", { class: "input", ...attrs });
  return { wrap: el("label", { class: "field" }, [el("span", { text: label }), input]), input };
}

export async function renderAuth(root, { onAuthenticated }) {
  clear(root);
  const account = await auth.getAccount();
  const bioAvailable = await biometric.isAvailable();
  const bioEnrolled = await biometric.isEnrolled();

  let mode = account ? "login" : "signup";

  const googleReady = google.isConfigured();

  /** "Continue with Google" — real OAuth via Google Identity Services. */
  const googleBlock = (fail) => {
    const btn = el(
      "button",
      {
        class: "btn btn-block google-btn",
        type: "button",
        disabled: !googleReady,
        html: `${GOOGLE_SVG}<span>Continue with Google</span>`,
        onClick: async () => {
          fail("");
          btn.disabled = true;
          try {
            const profile = await google.signIn();
            const session = await auth.signInWithGoogle(profile);
            await onAuthenticated(session, { firstRun: !account });
          } catch (err) {
            fail(err.message || "Google sign-in failed.");
            btn.disabled = false;
          }
        },
      },
      [],
    );

    return el("div", { class: "auth-provider" }, [
      el("div", { class: "auth-divider" }, [el("span", { text: "or" })]),
      btn,
      googleReady
        ? el("span", { hidden: true })
        : el("p", {
            class: "tiny faint",
            style: "margin-top:8px",
            text: "Add your Google OAuth client ID in js/config.js to switch this on. Gmail access arrives with the backend in a later phase.",
          }),
    ]);
  };

  const card = el("div", { class: "auth-card" });
  root.append(card);

  const draw = () => {
    clear(card);
    card.append(el("div", { class: "brand", text: "One Look" }));

    const error = el("div", { class: "form-error", hidden: true });
    const fail = (message) => {
      error.textContent = message;
      error.hidden = !message;
    };

    if (mode === "signup") {
      const name = field("Name", { type: "text", autocomplete: "name", placeholder: "Your name" });
      const email = field("Email", {
        type: "email",
        autocomplete: "email",
        placeholder: "you@example.com",
      });
      const pass = field("Passcode", {
        type: "password",
        autocomplete: "new-password",
        placeholder: "At least 6 characters",
      });

      const submit = el(
        "button",
        { class: "btn btn-block", "data-variant": "primary", type: "submit" },
        "Create account",
      );

      const form = el(
        "form",
        {
          onSubmit: async (event) => {
            event.preventDefault();
            error.hidden = true;
            submit.disabled = true;
            try {
              const session = await auth.signUp({
                name: name.input.value,
                email: email.input.value,
                passcode: pass.input.value,
              });
              await onAuthenticated(session, { firstRun: true });
            } catch (err) {
              fail(err.message);
              submit.disabled = false;
            }
          },
        },
        [name.wrap, email.wrap, pass.wrap, error, submit],
      );

      card.append(
        el("h1", { class: "auth-title", text: "Create your account" }),
        el("p", {
          class: "auth-sub",
          text: "Stored only on this device for now. Your passcode is hashed, never saved as text.",
        }),
        form,
        googleBlock(fail),
        account
          ? el("p", { class: "auth-alt" }, [
              el(
                "button",
                { type: "button", onClick: () => ((mode = "login"), draw()) },
                "Back to sign in",
              ),
            ])
          : el("span", { hidden: true }),
      );
      return;
    }

    /* Login / lock */
    const email = field("Email", {
      type: "email",
      autocomplete: "email",
      value: account?.email || "",
      placeholder: "you@example.com",
    });
    const pass = field("Passcode", {
      type: "password",
      autocomplete: "current-password",
      placeholder: "Your passcode",
    });

    const submit = el(
      "button",
      { class: "btn btn-block", "data-variant": "primary", type: "submit" },
      "Unlock",
    );

    const form = el(
      "form",
      {
        onSubmit: async (event) => {
          event.preventDefault();
          error.hidden = true;
          submit.disabled = true;
          try {
            const session = await auth.signIn({
              email: email.input.value,
              passcode: pass.input.value,
            });
            await onAuthenticated(session, { firstRun: false });
          } catch (err) {
            fail(err.message);
            submit.disabled = false;
          }
        },
      },
      [email.wrap, pass.wrap, error, submit],
    );

    card.append(
      el("h1", {
        class: "auth-title",
        text: `Welcome back${account?.name ? `, ${account.name.split(" ")[0]}` : ""}`,
      }),
      el("p", { class: "auth-sub", text: "Unlock to see what needs your attention." }),
      form,
    );

    if (!account?.hash) {
      /* Google-backed account: no passcode exists, so hide the passcode form. */
      form.hidden = true;
    }
    card.append(googleBlock(fail));

    /* Biometric only when the device really supports it AND it is enrolled. */
    if (bioAvailable && bioEnrolled) {
      const bioBtn = el(
        "button",
        {
          class: "btn btn-block bio-btn",
          type: "button",
          style: "margin-top:12px",
          html: `${FACE_SVG}<span>Use face or fingerprint</span>`,
          onClick: async () => {
            error.hidden = true;
            bioBtn.disabled = true;
            try {
              await biometric.verify();
              const session = await auth.resumeWithBiometric();
              await onAuthenticated(session, { firstRun: false });
            } catch (err) {
              fail(err.message || "Biometric unlock failed. Use your passcode.");
              bioBtn.disabled = false;
            }
          },
        },
        [],
      );
      card.append(bioBtn);
    }

    card.append(
      el("p", { class: "auth-alt" }, [
        "Different account? ",
        el(
          "button",
          {
            type: "button",
            onClick: () => {
              mode = "signup";
              draw();
            },
          },
          "Create a new one",
        ),
      ]),
    );
  };

  draw();
}

/** Offered right after signup on capable devices. Never faked. */
export async function offerBiometricEnrollment(session) {
  if (!(await biometric.isAvailable())) return false;
  if (await biometric.isEnrolled()) return false;
  try {
    await biometric.enroll(session);
    toast("Biometric unlock enabled");
    return true;
  } catch {
    return false;
  }
}
