import { beforeEach, describe, expect, it, vi } from "vitest";

const MESSENGER_PAGE_PATH = "../../public/js/pages/messenger.js";

function loadMessengerPageModule() {
  delete require.cache[require.resolve(MESSENGER_PAGE_PATH)];
  require(MESSENGER_PAGE_PATH);
}

describe("MessengerPage friend avatar rendering", () => {
  beforeEach(() => {
    global.window = {
      setTimeout,
      clearTimeout,
    };

    global.document = {
      getElementById: vi.fn(() => null),
      addEventListener: vi.fn(),
    };

    loadMessengerPageModule();
  });

  it("renders a profile-style avatar circle fallback for friends", () => {
    const page = new window.MessengerPage();

    const markup = page._renderFriendAvatarMarkup(
      {
        id: 7,
        displayedName: "Alice Example",
        avatarDataUrl: "data:image/png;base64,should-not-render-when-flag-is-off",
      },
      "Alice Example",
    );

    expect(markup).toContain("avatar-circle-modern messenger-list__avatar");
    expect(markup).toContain("messenger-list__avatar-fallback");
    expect(markup).toContain("AE");
    expect(markup).not.toContain("<img");
  });

  it("renders the uploaded avatar image only when avatar uploads are enabled", () => {
    const page = new window.MessengerPage();
    page.avatarUploadEnabled = true;

    const markup = page._renderFriendAvatarMarkup(
      {
        id: 8,
        displayedName: "Bob Farmer",
        avatarDataUrl: "data:image/png;base64,abc123",
      },
      "Bob Farmer",
    );

    expect(markup).toContain('<img class="profile-avatar-modern__image messenger-list__avatar-image"');
    expect(markup).toContain("data:image/png;base64,abc123");
    expect(markup).not.toContain("messenger-list__avatar-fallback");
  });
});
