class FarmlogBasePage {
  constructor() {
    this.authService = null;
    this.apiService = null;
    this.featureFlagsService = null;
    this.currentUser = null;
    this.isAuthenticated = false;
    this.farmlogEngagementEnabled = false;
  }

  requiresAuthentication() {
    return true;
  }

  async init(app) {
    this.authService = app.getModule("authService");
    this.apiService = app.getModule("apiService");
    this.featureFlagsService = app.getModule("featureFlagsService");

    if (!this.authService || !this.apiService || !this.featureFlagsService) {
      this._setStatus("Page dependencies are unavailable.", true);
      return;
    }

    const isAuthenticated = await this.authService.waitForAuth(3000);
    this.isAuthenticated = isAuthenticated;
    if (this.requiresAuthentication() && (!isAuthenticated || !this.authService.requireAuth("/login.html"))) {
      return;
    }

    const enabled = await this._ensureFeatureEnabled();
    if (!enabled) {
      return;
    }

    await this._loadFeatureCapabilities();

    try {
      this.currentUser = await this.authService.getCurrentUser();
    } catch (error) {
      this.currentUser = null;
    }

    await this.onReady();
  }

  async _ensureFeatureEnabled() {
    try {
      const enabled = await this.featureFlagsService.isEnabled("rolnopolFarmlogEnabled", false);
      if (!enabled) {
        window.location.replace("/404.html");
        return false;
      }
      return true;
    } catch (error) {
      window.location.replace("/404.html");
      return false;
    }
  }

  async _loadFeatureCapabilities() {
    try {
      // Prefer a fresh server-side value to avoid stale client cache causing UI/server mismatch.
      // refreshFlags returns the raw flags map when successful.
      let flags = null;
      if (this.featureFlagsService && typeof this.featureFlagsService.refreshFlags === "function") {
        try {
          flags = await this.featureFlagsService.refreshFlags();
        } catch (err) {
          // ignore and fall back to cached retrieval
          flags = null;
        }
      }

      if (!flags && this.featureFlagsService && typeof this.featureFlagsService.getFlagsCached === "function") {
        try {
          flags = await this.featureFlagsService.getFlagsCached();
        } catch (err) {
          flags = null;
        }
      }

      this.farmlogEngagementEnabled = !!(flags && flags.rolnopolFarmlogEngagementEnabled === true);
    } catch (error) {
      this.farmlogEngagementEnabled = false;
    }
    // Ensure UI reflects the freshly loaded flag as early as possible
    try {
      this._updateTopPostsTabVisibility?.();
    } catch (e) {
      // ignore DOM errors during server-side tests
    }
  }

  _updateTopPostsTabVisibility() {
    if (typeof document === "undefined") return;

    try {
      const topTabButtons = document.querySelectorAll('[data-result-tab="top-posts"]');
      if (!topTabButtons || topTabButtons.length === 0) return;

      topTabButtons.forEach((btn) => {
        if (!btn) return;
        try {
          if (!this.farmlogEngagementEnabled) {
            // Hide aggressively to avoid CSS or sequencing issues where [hidden] might be overridden
            btn.hidden = true;
            try {
              btn.style.setProperty("display", "none", "important");
            } catch (err) {
              btn.style.display = "none";
            }
            btn.setAttribute("aria-hidden", "true");
          } else {
            btn.hidden = false;
            try {
              btn.style.removeProperty("display");
            } catch (err) {
              btn.style.display = "";
            }
            btn.removeAttribute("aria-hidden");
          }
        } catch (err) {
          // ignore individual element errors
        }
      });
    } catch (err) {
      // ignore DOM traversal errors
    }
  }

  _getCurrentUserId() {
    if (!this.currentUser) return null;
    return this.currentUser.userId || this.currentUser.id || null;
  }

  _setStatus(message, isError = false) {
    const statusEl = document.getElementById("farmlogStatus");
    if (!statusEl) return;
    statusEl.hidden = !message;
    statusEl.textContent = message || "";
    statusEl.className = `farmlog-status${isError ? " farmlog-status--error" : ""}`;
  }

  _setDetailLoadingState(isLoading) {
    const targets = ["blogDetailHeader", "blogInfoPanel", "blogPostsList"];

    targets.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) {
        return;
      }

      element.classList.toggle("is-loading", isLoading);
      element.setAttribute("aria-busy", isLoading ? "true" : "false");
    });
  }

  async _runWithPreservedScroll(task, options = {}) {
    if (typeof task !== "function") {
      return undefined;
    }

    const hasWindow = typeof window !== "undefined";
    const left = hasWindow ? (window.scrollX ?? window.pageXOffset ?? 0) : 0;
    const top = hasWindow ? (window.scrollY ?? window.pageYOffset ?? 0) : 0;
    const elementIds = Array.isArray(options.elementIds) ? options.elementIds : [];
    const elementScrollStates =
      typeof document !== "undefined"
        ? elementIds
            .map((id) => {
              const element = document.getElementById(id);
              if (!element) {
                return null;
              }

              return {
                id,
                left: element.scrollLeft ?? 0,
                top: element.scrollTop ?? 0,
              };
            })
            .filter(Boolean)
        : [];

    const result = await task();

    await new Promise((resolve) => {
      const restoreScroll = () => {
        if (hasWindow && typeof window.scrollTo === "function") {
          window.scrollTo(left, top);
        }

        if (typeof document !== "undefined") {
          elementScrollStates.forEach((state) => {
            const element = document.getElementById(state.id);
            if (!element) {
              return;
            }

            if (typeof element.scrollLeft === "number") {
              element.scrollLeft = state.left;
            }

            if (typeof element.scrollTop === "number") {
              element.scrollTop = state.top;
            }
          });
        }

        resolve();
      };

      if (hasWindow && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => window.requestAnimationFrame(restoreScroll));
      } else {
        restoreScroll();
      }
    });

    return result;
  }

  _escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  _formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  }

  _parseTags(rawTags) {
    if (!rawTags || typeof rawTags !== "string") {
      return [];
    }

    return rawTags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 5);
  }

  _getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  _toBlogLink(slug) {
    return `/farmlog-blog.html?blog=${encodeURIComponent(slug)}`;
  }

  _toPostLink(blogSlug, postSlug) {
    return `/farmlog-post.html?blog=${encodeURIComponent(blogSlug)}&post=${encodeURIComponent(postSlug)}`;
  }

  _getPeriodLabel(period) {
    const labels = {
      "1d": "1 day",
      "7d": "7 days",
      "14d": "14 days",
      "30d": "30 days",
      "1y": "1 year",
      all: "all time",
    };

    return labels[String(period || "all").toLowerCase()] || "all time";
  }

  _renderFavoriteButton({ targetType, blogSlug, postSlug = null, isActive = false, label = null } = {}) {
    if (!this.farmlogEngagementEnabled) {
      return "";
    }

    const normalizedTargetType = targetType === "blog" ? "blog" : "post";
    const actionLabel =
      label || (normalizedTargetType === "blog" ? (isActive ? "Favorited blog" : "Favorite blog") : isActive ? "Saved post" : "Save post");

    return `
      <button
        type="button"
        class="farmlog-engagement-btn farmlog-engagement-btn--favorite${isActive ? " is-active" : ""}"
        data-engagement-action="toggle-favorite"
        data-target-type="${normalizedTargetType}"
        data-blog="${this._escapeHtml(blogSlug || "")}"
        ${postSlug ? `data-post="${this._escapeHtml(postSlug)}"` : ""}
        data-active="${isActive ? "true" : "false"}"
        aria-pressed="${isActive ? "true" : "false"}"
        aria-label="${this._escapeHtml(actionLabel)}"
        title="${this._escapeHtml(actionLabel)}"
      >
        <i class="${isActive ? "fas" : "far"} fa-bookmark"></i>
        <span>${this._escapeHtml(actionLabel)}</span>
      </button>
    `;
  }

  _renderLikeButton({ blogSlug, postSlug, isActive = false, likesCount = 0 } = {}) {
    if (!this.farmlogEngagementEnabled) {
      return "";
    }

    const label = isActive ? "Liked post" : "Like post";
    const normalizedLikesCount = Number.isFinite(Number(likesCount)) ? Number(likesCount) : 0;

    return `
      <button
        type="button"
        class="farmlog-engagement-btn farmlog-engagement-btn--like${isActive ? " is-active" : ""}"
        data-engagement-action="toggle-like"
        data-blog="${this._escapeHtml(blogSlug || "")}"
        data-post="${this._escapeHtml(postSlug || "")}"
        data-active="${isActive ? "true" : "false"}"
        aria-pressed="${isActive ? "true" : "false"}"
        aria-label="${this._escapeHtml(label)}"
        title="${this._escapeHtml(label)}"
      >
        <i class="${isActive ? "fas" : "far"} fa-heart"></i>
        <span>${normalizedLikesCount} like${normalizedLikesCount === 1 ? "" : "s"}</span>
      </button>
    `;
  }

  _renderPostEngagementActions(post, blogSlug, options = {}) {
    if (!this.farmlogEngagementEnabled) {
      return "";
    }

    const resolvedBlogSlug = blogSlug || post?.blogSlug || "";
    const period = String(options.period || "all").toLowerCase();
    const periodBadge =
      options.showPeriodBadge === true && period !== "all"
        ? `<span class="farmlog-period-chip"><i class="fas fa-fire"></i> ${Number(post?.periodLikesCount || 0)} in ${this._escapeHtml(this._getPeriodLabel(period))}</span>`
        : "";

    return `
      <div class="farmlog-engagement-row">
        ${this._renderLikeButton({
          blogSlug: resolvedBlogSlug,
          postSlug: post?.slug,
          isActive: post?.likedByCurrentUser === true,
          likesCount: post?.likesCount || 0,
        })}
        ${this._renderFavoriteButton({
          targetType: "post",
          blogSlug: resolvedBlogSlug,
          postSlug: post?.slug,
          isActive: post?.favoritedByCurrentUser === true,
          label: post?.favoritedByCurrentUser === true ? "Saved post" : "Save post",
        })}
        ${periodBadge}
      </div>
    `;
  }

  async _performEngagementRequest(button) {
    if (!this.farmlogEngagementEnabled || !button) {
      return null;
    }

    if (!this._getCurrentUserId()) {
      this._setStatus("Log in to like posts and save favorites.", true);
      return null;
    }

    const action = button.getAttribute("data-engagement-action");
    const targetType = button.getAttribute("data-target-type");
    const blogSlug = button.getAttribute("data-blog");
    const postSlug = button.getAttribute("data-post");
    const isActive = button.getAttribute("data-active") === "true";

    if (!action || !blogSlug) {
      return null;
    }

    let response = null;
    let successMessage = "Updated successfully.";

    button.disabled = true;

    try {
      if (action === "toggle-like" && postSlug) {
        successMessage = isActive ? "Like removed." : "Post liked.";
        response = isActive
          ? await this.apiService.delete(`blogs/${blogSlug}/posts/${postSlug}/like`, { requiresAuth: true })
          : await this.apiService.post(`blogs/${blogSlug}/posts/${postSlug}/like`, {}, { requiresAuth: true });
      } else if (action === "toggle-favorite" && targetType === "blog") {
        successMessage = isActive ? "Removed blog from favorites." : "Blog saved to favorites.";
        response = isActive
          ? await this.apiService.delete(`blogs/${blogSlug}/favorite`, { requiresAuth: true })
          : await this.apiService.post(`blogs/${blogSlug}/favorite`, {}, { requiresAuth: true });
      } else if (action === "toggle-favorite" && postSlug) {
        successMessage = isActive ? "Removed post from favorites." : "Post saved to favorites.";
        response = isActive
          ? await this.apiService.delete(`blogs/${blogSlug}/posts/${postSlug}/favorite`, { requiresAuth: true })
          : await this.apiService.post(`blogs/${blogSlug}/posts/${postSlug}/favorite`, {}, { requiresAuth: true });
      }
    } finally {
      button.disabled = false;
    }

    if (!response || !response.success) {
      this._setStatus(response?.error || "Unable to update Farmlog reactions.", true);
      return null;
    }

    this._setStatus(successMessage);
    return response.data?.data || null;
  }

  _renderMarkdown(markdown) {
    const normalized = String(markdown || "").replace(/\r\n/g, "\n");

    // Escape first, then allow selected markdown tokens.
    let html = this._escapeHtml(normalized);

    html = html.replace(/```([\s\S]*?)```/g, (_match, code) => `<pre><code>${code.trim()}</code></pre>`);
    html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    const lines = html.split("\n");
    const out = [];
    let inList = false;

    for (const line of lines) {
      if (/^[-*]\s+/.test(line)) {
        if (!inList) {
          out.push("<ul>");
          inList = true;
        }
        out.push(`<li>${line.replace(/^[-*]\s+/, "")}</li>`);
      } else {
        if (inList) {
          out.push("</ul>");
          inList = false;
        }

        if (line.trim().length === 0) {
          out.push("");
        } else if (!/^<h[1-3]>/.test(line) && !/^<pre>/.test(line)) {
          out.push(`<p>${line}</p>`);
        } else {
          out.push(line);
        }
      }
    }

    if (inList) {
      out.push("</ul>");
    }

    return out.join("\n");
  }

  _renderMarkdownWithLimit(markdown, maxChars = null) {
    const source = String(markdown || "");
    const trimmed = source.trim();

    if (!trimmed) {
      return "<p class='farmlog-empty'>Nothing to preview yet.</p>";
    }

    if (!Number.isFinite(maxChars) || maxChars <= 0) {
      return this._renderMarkdown(source);
    }

    const sliced = source.slice(0, maxChars);
    const suffix = source.length > maxChars ? "..." : "";
    return this._renderMarkdown(`${sliced}${suffix}`);
  }

  _bindMarkdownPreview(textareaId, previewId, maxChars = null) {
    const textarea = document.getElementById(textareaId);
    const preview = document.getElementById(previewId);

    if (!textarea || !preview) {
      return;
    }

    const renderPreview = () => {
      preview.innerHTML = this._renderMarkdownWithLimit(textarea.value, maxChars);
    };

    textarea.addEventListener("input", renderPreview);
    renderPreview();
  }

  async onReady() {}
}

class FarmlogHubPage extends FarmlogBasePage {
  constructor() {
    super();
    this.blogResults = [];
    this.postResults = [];
    this.topPostResults = [];
    this.blogSlugById = new Map();
    this.activeTab = "blogs";
    this.postSort = "newest";
    this.topPostsPeriod = "7d";
    this.userBlog = null;
    this.userBlogPosts = [];
    this.hasResolvedUserBlog = false;
    this.userPanelCollapsed = true;
    this.userPanelCollapseStorageKey = "farmlog:user-panel-collapsed";
    this.desktopPanelMediaQuery = typeof window !== "undefined" ? window.matchMedia("(min-width: 901px)") : null;
  }

  _isBlogActive(blog) {
    return !!blog && blog.deletedAt == null;
  }

  _isOwnedByCurrentUser(blog, userId) {
    if (!blog || userId == null) {
      return false;
    }

    return String(blog.userId) === String(userId);
  }

  async onReady() {
    this._restoreUserPanelCollapsePreference();
    this._bindEvents();
    this._renderSearchControls();
    this._applyUserPanelCollapseState();
    await this._loadInitialData();
  }

  requiresAuthentication() {
    return false;
  }

  _bindEvents() {
    const searchForm = document.getElementById("farmlogSearchForm");
    const tabs = document.querySelectorAll("[data-result-tab]");
    const createBlogForm = document.getElementById("createBlogForm");
    const createPostForm = document.getElementById("createUserPostForm");
    const userBlogDetails = document.getElementById("userBlogDetails");
    const publicSearchPanel = document.getElementById("publicSearchPanel");
    const postSortEl = document.getElementById("farmlogPostsSort");
    const topPeriodEl = document.getElementById("farmlogTopPeriod");
    const userBlogPanelToggle = document.getElementById("yourBlogPanelToggle");

    if (searchForm) {
      searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this._performSearch();
      });
    }

    tabs.forEach((button) => {
      button.addEventListener("click", () => {
        this.activeTab = button.getAttribute("data-result-tab") || "blogs";
        this._renderSearchControls();
        this._renderSearchResults();
      });
    });

    if (postSortEl) {
      postSortEl.addEventListener("change", () => {
        this.postSort = postSortEl.value || "newest";
        this._performSearch();
      });
    }

    if (topPeriodEl) {
      topPeriodEl.addEventListener("change", () => {
        this.topPostsPeriod = topPeriodEl.value || "7d";
        this._performSearch();
      });
    }

    if (createBlogForm) {
      createBlogForm.hidden = true;
      createBlogForm.addEventListener("submit", (event) => this._handleCreateBlog(event));
    }

    if (createPostForm) {
      createPostForm.addEventListener("submit", (event) => this._handleCreateUserPost(event));
    }

    if (userBlogDetails) {
      userBlogDetails.addEventListener("submit", (event) => {
        if (event.target && event.target.id === "editBlogForm") {
          this._handleEditBlog(event);
        }
      });

      userBlogDetails.addEventListener("click", (event) => {
        const target = event.target;
        if (!target || !(target instanceof HTMLButtonElement)) {
          return;
        }

        if (target.id === "deleteBlogBtn") {
          this._handleDeleteBlog();
        }
      });
    }

    if (publicSearchPanel) {
      publicSearchPanel.addEventListener("click", (event) => this._handleSearchPanelAction(event));
    }

    if (userBlogPanelToggle) {
      userBlogPanelToggle.addEventListener("click", () => this._toggleUserPanelCollapse());
    }

    if (this.desktopPanelMediaQuery) {
      const handleViewportChange = () => this._applyUserPanelCollapseState();
      if (typeof this.desktopPanelMediaQuery.addEventListener === "function") {
        this.desktopPanelMediaQuery.addEventListener("change", handleViewportChange);
      } else if (typeof this.desktopPanelMediaQuery.addListener === "function") {
        this.desktopPanelMediaQuery.addListener(handleViewportChange);
      }
    }

    this._bindMarkdownPreview("createUserPostContent", "createUserPostPreview");
  }

  _restoreUserPanelCollapsePreference() {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      const storedValue = window.localStorage.getItem(this.userPanelCollapseStorageKey);
      this.userPanelCollapsed = storedValue == null ? true : storedValue === "true";
    } catch (error) {
      this.userPanelCollapsed = true;
    }
  }

  _persistUserPanelCollapsePreference() {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(this.userPanelCollapseStorageKey, this.userPanelCollapsed ? "true" : "false");
    } catch (error) {
      // Ignore storage failures and continue with in-memory state only.
    }
  }

  _toggleUserPanelCollapse() {
    if (this.desktopPanelMediaQuery && !this.desktopPanelMediaQuery.matches) {
      return;
    }

    this.userPanelCollapsed = !this.userPanelCollapsed;
    this._persistUserPanelCollapsePreference();
    this._applyUserPanelCollapseState();
  }

  _applyUserPanelCollapseState() {
    const layout = document.getElementById("farmlogLayout");
    const panel = document.getElementById("yourBlogPanel");
    const toggle = document.getElementById("yourBlogPanelToggle");
    const canCollapse = !this.desktopPanelMediaQuery || this.desktopPanelMediaQuery.matches;
    const isCollapsed = canCollapse && this.userPanelCollapsed;

    if (layout) {
      layout.classList.toggle("farmlog-layout--user-panel-collapsed", isCollapsed);
    }

    if (panel) {
      panel.classList.toggle("is-collapsed", isCollapsed);
    }

    if (toggle) {
      const icon = toggle.querySelector("i");
      const text = toggle.querySelector(".farmlog-panel-toggle__text");
      const actionLabel = isCollapsed ? "Expand your blog panel" : "Collapse your blog panel";

      toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      toggle.setAttribute("aria-label", actionLabel);
      toggle.setAttribute("title", actionLabel);

      if (text) {
        text.textContent = isCollapsed ? "Your Blog" : "Collapse";
      }

      if (icon) {
        icon.className = `fas ${isCollapsed ? "fa-chevron-right" : "fa-chevron-left"}`;
      }
    }
  }

  async _loadInitialData() {
    this._setStatus("Loading your Farmlog...");
    this.hasResolvedUserBlog = false;

    const isLoggedIn = !!this._getCurrentUserId();
    const blogResponse = await this.apiService.get("blogs", { requiresAuth: isLoggedIn });
    if (!blogResponse.success) {
      this._setStatus(blogResponse.error || "Failed to load blogs.", true);
      this._renderUserColumn();
      return;
    }

    const blogs = Array.isArray(blogResponse.data?.data) ? blogResponse.data.data : [];
    const userId = this._getCurrentUserId();
    this.userBlog = blogs.find((blog) => this._isOwnedByCurrentUser(blog, userId) && this._isBlogActive(blog)) || null;
    this.hasResolvedUserBlog = true;

    if (this.userBlog) {
      await this._loadUserBlogPosts();
    }

    this._renderUserColumn();
    await this._performSearch();
    this._setStatus("");
  }

  async _loadUserBlogPosts() {
    if (!this.userBlog) {
      this.userBlogPosts = [];
      return;
    }

    const response = await this.apiService.get(`blogs/${this.userBlog.slug}/posts`, {
      requiresAuth: true,
      query: { limit: 5, offset: 0 },
    });

    this.userBlogPosts = response.success && Array.isArray(response.data?.data) ? response.data.data : [];
  }

  _renderSearchControls() {
    const controls = document.getElementById("farmlogSearchControls");
    const postSortWrap = document.getElementById("farmlogPostsSortWrap");
    const topPeriodWrap = document.getElementById("farmlogTopPeriodWrap");
    // Update visibility for all "most liked" tab buttons (use helper to enforce style)
    try {
      this._updateTopPostsTabVisibility?.();
    } catch (e) {
      // ignore DOM errors
    }

    if (!this.farmlogEngagementEnabled && this.activeTab === "top-posts") {
      this.activeTab = "blogs";
    }

    if (!controls || !postSortWrap || !topPeriodWrap) {
      return;
    }

    controls.hidden = !this.farmlogEngagementEnabled || this.activeTab === "blogs";
    postSortWrap.hidden = !this.farmlogEngagementEnabled || this.activeTab !== "posts";
    topPeriodWrap.hidden = !this.farmlogEngagementEnabled || this.activeTab !== "top-posts";

    const postSortEl = document.getElementById("farmlogPostsSort");
    const topPeriodEl = document.getElementById("farmlogTopPeriod");
    if (postSortEl) {
      postSortEl.value = this.postSort;
    }
    if (topPeriodEl) {
      topPeriodEl.value = this.topPostsPeriod;
    }
  }

  async _handleSearchPanelAction(event) {
    const button = event.target.closest("[data-engagement-action]");
    if (!button) {
      return;
    }

    event.preventDefault();

    const updatedEntity = await this._performEngagementRequest(button);
    if (!updatedEntity) {
      return;
    }

    await this._runWithPreservedScroll(() => this._loadInitialData(), {
      elementIds: ["searchBlogsResults", "searchPostsResults", "searchTopPostsResults"],
    });
  }

  async _performSearch() {
    const queryInput = document.getElementById("farmlogSearchInput");
    const query = (queryInput?.value || "").trim();
    const isLoggedIn = !!this._getCurrentUserId();

    this._setStatus("Searching public blogs and posts...");
    this._showSkeletonLoaders();

    const postQuery = { q: query };
    if (this.farmlogEngagementEnabled && this.postSort !== "newest") {
      postQuery.sort = this.postSort;
    }

    const requests = [
      this.apiService.get("blogs/search", { requiresAuth: isLoggedIn, query: { q: query } }),
      this.apiService.get("blogs/posts/search", { requiresAuth: isLoggedIn, query: postQuery }),
    ];

    if (this.farmlogEngagementEnabled) {
      requests.push(
        this.apiService.get("blogs/posts/search", {
          requiresAuth: isLoggedIn,
          query: { q: query, sort: "most-liked", period: this.topPostsPeriod },
        }),
      );
    }

    const [blogsResponse, postsResponse, topPostsResponse] = await Promise.all(requests);

    if (!blogsResponse.success || !postsResponse.success || (this.farmlogEngagementEnabled && !topPostsResponse?.success)) {
      this._setStatus("Search failed. Please try again.", true);
      return;
    }

    this.blogResults = Array.isArray(blogsResponse.data?.data) ? blogsResponse.data.data : [];
    this.postResults = Array.isArray(postsResponse.data?.data) ? postsResponse.data.data : [];
    this.topPostResults = this.farmlogEngagementEnabled && Array.isArray(topPostsResponse?.data?.data) ? topPostsResponse.data.data : [];

    this.blogSlugById = new Map();
    this.blogResults.forEach((blog) => {
      if (blog && blog.id != null && typeof blog.slug === "string") {
        this.blogSlugById.set(blog.id, blog.slug);
      }
    });

    if (this.userBlog && this.userBlog.id != null && typeof this.userBlog.slug === "string") {
      this.blogSlugById.set(this.userBlog.id, this.userBlog.slug);
    }

    this._renderSearchResults();
    this._setStatus("");
  }

  async _handleCreateBlog(event) {
    event.preventDefault();
    const titleEl = document.getElementById("createBlogTitle");
    const visibilityEl = document.getElementById("createBlogVisibility");
    const tagsEl = document.getElementById("createBlogTags");

    const payload = {
      title: (titleEl?.value || "").trim(),
      visibility: visibilityEl?.value || "public",
      tags: this._parseTags(tagsEl?.value || ""),
    };

    if (!payload.title) {
      this._setStatus("Blog title is required.", true);
      return;
    }

    const response = await this.apiService.post("blogs", payload, { requiresAuth: true });
    if (!response.success) {
      this._setStatus(response.error || "Failed to create blog.", true);
      return;
    }

    if (titleEl) titleEl.value = "";
    if (tagsEl) tagsEl.value = "";

    this._setStatus("Blog created.");
    await this._loadInitialData();
  }

  async _handleEditBlog(event) {
    event.preventDefault();
    if (!this.userBlog) {
      this._setStatus("Blog not found.", true);
      return;
    }

    const titleEl = document.getElementById("editBlogTitle");
    const visibilityEl = document.getElementById("editBlogVisibility");
    const tagsEl = document.getElementById("editBlogTags");

    const payload = {
      title: (titleEl?.value || "").trim(),
      visibility: visibilityEl?.value || "public",
      tags: this._parseTags(tagsEl?.value || ""),
    };

    if (!payload.title) {
      this._setStatus("Blog title is required.", true);
      return;
    }

    const response = await this.apiService.request("PATCH", `blogs/${this.userBlog.slug}`, {
      requiresAuth: true,
      body: payload,
    });

    if (!response.success) {
      this._setStatus(response.error || "Failed to update blog.", true);
      return;
    }

    this._setStatus("Blog updated.");
    await this._loadInitialData();
  }

  async _handleDeleteBlog() {
    if (!this.userBlog) {
      this._setStatus("Blog not found.", true);
      return;
    }

    const confirmed = await showConfirmationModal({
      title: "Delete Blog",
      message: "Delete your blog and hide all of its posts? This action cannot be undone.",
      confirmText: "Delete Blog",
      cancelText: "Cancel",
    });
    if (!confirmed) {
      return;
    }

    const response = await this.apiService.delete(`blogs/${this.userBlog.slug}`, {
      requiresAuth: true,
    });

    if (!response.success) {
      this._setStatus(response.error || "Failed to delete blog.", true);
      return;
    }

    this._setStatus("Blog deleted.");
    await this._loadInitialData();
  }

  async _handleCreateUserPost(event) {
    event.preventDefault();
    if (!this.userBlog) {
      this._setStatus("Create your blog first.", true);
      return;
    }

    const titleEl = document.getElementById("createUserPostTitle");
    const contentEl = document.getElementById("createUserPostContent");

    const payload = {
      title: (titleEl?.value || "").trim(),
      content: (contentEl?.value || "").trim(),
    };

    if (!payload.title || !payload.content) {
      this._setStatus("Post title and content are required.", true);
      return;
    }

    const response = await this.apiService.post(`blogs/${this.userBlog.slug}/posts`, payload, {
      requiresAuth: true,
    });

    if (!response.success) {
      this._setStatus(response.error || "Failed to create post.", true);
      return;
    }

    if (titleEl) titleEl.value = "";
    if (contentEl) contentEl.value = "";

    const previewEl = document.getElementById("createUserPostPreview");
    if (previewEl) {
      previewEl.innerHTML = this._renderMarkdownWithLimit("", null);
    }

    this._setStatus("Post created.");
    await this._loadInitialData();
  }

  _renderUserColumn() {
    const emptyState = document.getElementById("userBlogEmpty");
    const details = document.getElementById("userBlogDetails");
    const createPostPanel = document.getElementById("createUserPostPanel");
    const createBlogForm = document.getElementById("createBlogForm");
    const emptyText = emptyState?.querySelector(".farmlog-empty");
    const isLoggedIn = !!this._getCurrentUserId();
    const hasActiveBlog = this._isBlogActive(this.userBlog);

    if (!emptyState || !details || !createPostPanel) {
      return;
    }

    if (!isLoggedIn) {
      if (emptyText) {
        emptyText.innerHTML =
          'Join Farmlog to create your own blog and publish posts. <a href="/login.html">Log in</a> or <a href="/register.html">create an account</a> to get started.';
        emptyText.hidden = false;
      }
      if (createBlogForm) {
        createBlogForm.hidden = true;
      }
      // Clear skeleton cards
      const skeletons = emptyState.querySelectorAll(".farmlog-skeleton-card");
      skeletons.forEach((skeleton) => skeleton.remove());
      emptyState.hidden = false;
      emptyState.classList.remove("is-loading");
      details.hidden = true;
      createPostPanel.hidden = true;
      return;
    }

    if (!this.userBlog) {
      if (emptyText) {
        emptyText.textContent = "You do not have a blog yet.";
        emptyText.hidden = false;
      }
      if (createBlogForm) {
        createBlogForm.hidden = !this.hasResolvedUserBlog || hasActiveBlog;
      }
      // Clear skeleton cards
      const skeletons = emptyState.querySelectorAll(".farmlog-skeleton-card");
      skeletons.forEach((skeleton) => skeleton.remove());
      emptyState.hidden = false;
      emptyState.classList.remove("is-loading");
      details.hidden = true;
      createPostPanel.hidden = true;
      return;
    }

    if (createBlogForm) {
      createBlogForm.hidden = true;
    }

    // Clear skeleton cards before showing blog details
    const skeletons = emptyState.querySelectorAll(".farmlog-skeleton-card");
    skeletons.forEach((skeleton) => skeleton.remove());
    emptyState.hidden = true;
    emptyState.classList.remove("is-loading");
    details.hidden = false;
    createPostPanel.hidden = false;

    const tags = Array.isArray(this.userBlog.tags) ? this.userBlog.tags.join(", ") : "-";
    const postCount = this.userBlogPosts.length;
    const visibilityLabel = this.userBlog.visibility === "public" ? "Public blog" : "Private blog";
    const listMarkup = this.userBlogPosts
      .map((post) => {
        const postLink = this._toPostLink(this.userBlog.slug, post.slug);
        const snippetHtml = this._renderMarkdownWithLimit(post.content || "", 200);
        return `
          <li class="farmlog-mini-list__item farmlog-mini-list__item--post">
            <a href="${postLink}" class="farmlog-mini-list__link">${this._escapeHtml(post.title)}</a>
            <div class="farmlog-mini-list__content">${snippetHtml}</div>
            <div class="farmlog-mini-list__meta">
              <span>${this._formatDate(post.createdAt)}</span>
              ${this.farmlogEngagementEnabled ? `<span><i class="fas fa-heart"></i> ${Number(post.likesCount || 0)}</span>` : ""}
              <a href="${postLink}" class="btn btn-compact btn-outline">Read more</a>
            </div>
          </li>
        `;
      })
      .join("");

    details.innerHTML = `
      <div class="user-blog-details__card glass">
        <div class="user-blog-details__hero">
          <div>
            <p class="user-blog-details__eyebrow">Your blog</p>
            <h3>${this._escapeHtml(this.userBlog.title)}</h3>
          </div>
          <div class="user-blog-details__badges">
            <span class="farmlog-pill user-blog-details__pill">${this._escapeHtml(visibilityLabel)}</span>
            <span class="farmlog-pill user-blog-details__pill">${postCount} post${postCount === 1 ? "" : "s"}</span>
          </div>
        </div>

        <dl class="user-blog-details__meta">
          <div class="user-blog-details__meta-item">
            <dt>Slug</dt>
            <dd>${this._escapeHtml(this.userBlog.slug)}</dd>
          </div>
          <div class="user-blog-details__meta-item">
            <dt>Visibility</dt>
            <dd>${this._escapeHtml(this.userBlog.visibility)}</dd>
          </div>
          <div class="user-blog-details__meta-item user-blog-details__meta-item--wide">
            <dt>Tags</dt>
            <dd>${this._escapeHtml(tags)}</dd>
          </div>
          <div class="user-blog-details__meta-item user-blog-details__meta-item--wide">
            <dt>Blog link</dt>
            <dd><a href="${this._toBlogLink(this.userBlog.slug)}">${this._escapeHtml(this.userBlog.title)}</a></dd>
          </div>
        </dl>

        <div class="user-blog-details__actions">
          <a class="btn btn-compact btn-outline" href="${this._toBlogLink(this.userBlog.slug)}">Open blog detail</a>
        </div>

        <details class="user-blog-details__section">
          <summary class="user-blog-details__summary">
            <div>
              <p class="user-blog-details__eyebrow user-blog-details__eyebrow--section">Manage Blog</p>
              <h4>Update the blog settings</h4>
            </div>
            <span class="user-blog-details__summary-hint" aria-hidden="true">
              <i class="fas fa-chevron-down"></i>
            </span>
          </summary>
          <div class="user-blog-details__section-content">
            <form id="editBlogForm" class="farmlog-form user-blog-details__form">
              <input id="editBlogTitle" class="form-input-modern" type="text" maxlength="255" value="${this._escapeHtml(this.userBlog.title)}" required />
              <select id="editBlogVisibility" class="form-input-modern">
                <option value="public" ${this.userBlog.visibility === "public" ? "selected" : ""}>Public</option>
                <option value="private" ${this.userBlog.visibility === "private" ? "selected" : ""}>Private</option>
              </select>
              <input id="editBlogTags" class="form-input-modern" type="text" value="${this._escapeHtml((this.userBlog.tags || []).join(", "))}" placeholder="Tags (comma separated, max 5)" />
              <div class="farmlog-inline-actions">
                <button type="submit" class="btn btn-compact btn-futuristic">Save blog</button>
                <button type="button" id="deleteBlogBtn" class="btn btn-compact btn-outline">Delete blog</button>
              </div>
            </form>
          </div>
        </details>

        <details class="user-blog-details__section">
          <summary class="user-blog-details__summary">
            <div>
              <p class="user-blog-details__eyebrow user-blog-details__eyebrow--section">Recent Posts</p>
              <h4>Your latest posts</h4>
            </div>
            <span class="user-blog-details__summary-hint" aria-hidden="true">
              <i class="fas fa-chevron-down"></i>
            </span>
          </summary>
          <div class="user-blog-details__section-content">
            <ul class="farmlog-mini-list">${listMarkup || '<li class="farmlog-mini-list__item farmlog-mini-list__item--empty">No posts yet. Publish your first update to bring this space to life.</li>'}</ul>
          </div>
        </details>
      </div>
    `;
  }

  _renderSearchResults() {
    const tabs = document.querySelectorAll("[data-result-tab]");
    const blogsPanel = document.getElementById("searchBlogsResults");
    const postsPanel = document.getElementById("searchPostsResults");
    const topPostsPanel = document.getElementById("searchTopPostsResults");

    this._hideSkeletonLoaders();
    this._renderSearchControls();

    tabs.forEach((button) => {
      const tab = button.getAttribute("data-result-tab");
      const isActive = tab === this.activeTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    if (blogsPanel) {
      blogsPanel.hidden = this.activeTab !== "blogs";
      blogsPanel.innerHTML = this.blogResults.length
        ? this.blogResults
            .map((blog) => {
              const favoriteMarkup = this.farmlogEngagementEnabled
                ? `<div class="farmlog-result-card__footer">${this._renderFavoriteButton({
                    targetType: "blog",
                    blogSlug: blog.slug,
                    isActive: blog.favoritedByCurrentUser === true,
                    label: blog.favoritedByCurrentUser === true ? "Favorited blog" : "Favorite blog",
                  })}</div>`
                : "";

              return `
                <article class="farmlog-result-card">
                  <h3><a href="${this._toBlogLink(blog.slug)}">${this._escapeHtml(blog.title)}</a></h3>
                  <p><strong>Author:</strong> ${this._escapeHtml(blog.authorName || "Unknown")}</p>
                  <p><strong>Tags:</strong> ${this._escapeHtml((blog.tags || []).join(", ") || "-")}</p>
                  <p><strong>Created:</strong> ${this._formatDate(blog.createdAt)}</p>
                  ${favoriteMarkup}
                </article>
              `;
            })
            .join("")
        : "<p class='farmlog-empty'>No public blogs found.</p>";
    }

    if (postsPanel) {
      postsPanel.hidden = this.activeTab !== "posts";
      postsPanel.innerHTML = this.postResults.length
        ? this.postResults
            .map((post) => {
              const snippetHtml = this._renderMarkdownWithLimit(post.content || "", 140);
              const resolvedBlogSlug = post.blogSlug || this.blogSlugById.get(post.blogId) || "unknown-blog";
              const engagementMarkup = this._renderPostEngagementActions(post, resolvedBlogSlug);

              return `
                <article class="farmlog-result-card">
                  <h3><a href="${this._toPostLink(resolvedBlogSlug, post.slug)}">${this._escapeHtml(post.title)}</a></h3>
                  <p><strong>Author:</strong> ${this._escapeHtml(post.authorName || "Unknown")}</p>
                  <p><strong>Blog:</strong> <a href="${this._toBlogLink(resolvedBlogSlug)}">${this._escapeHtml(resolvedBlogSlug)}</a></p>
                  <div class="farmlog-markdown-snippet">${snippetHtml}</div>
                  <p><strong>Created:</strong> ${this._formatDate(post.createdAt)}</p>
                  ${engagementMarkup}
                </article>
              `;
            })
            .join("")
        : "<p class='farmlog-empty'>No public posts found.</p>";
    }

    if (topPostsPanel) {
      topPostsPanel.hidden = !this.farmlogEngagementEnabled || this.activeTab !== "top-posts";

      if (!this.farmlogEngagementEnabled) {
        topPostsPanel.innerHTML = "";
      } else {
        topPostsPanel.innerHTML = this.topPostResults.length
          ? // Ensure top posts are displayed sorted by likesCount -> periodLikesCount -> createdAt
            [...this.topPostResults]
              .sort((a, b) => {
                const aTotal = Number.isFinite(Number(a?.likesCount)) ? Number(a.likesCount) : 0;
                const bTotal = Number.isFinite(Number(b?.likesCount)) ? Number(b.likesCount) : 0;
                if (bTotal !== aTotal) return bTotal - aTotal;

                const aPeriod = Number.isFinite(Number(a?.periodLikesCount)) ? Number(a.periodLikesCount) : 0;
                const bPeriod = Number.isFinite(Number(b?.periodLikesCount)) ? Number(b.periodLikesCount) : 0;
                if (bPeriod !== aPeriod) return bPeriod - aPeriod;

                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              })
              .map((post) => {
                const resolvedBlogSlug = post.blogSlug || this.blogSlugById.get(post.blogId) || "unknown-blog";
                const snippetHtml = this._renderMarkdownWithLimit(post.content || "", 140);

                return `
                  <article class="farmlog-result-card">
                    <h3><a href="${this._toPostLink(resolvedBlogSlug, post.slug)}">${this._escapeHtml(post.title)}</a></h3>
                    <p><strong>Author:</strong> ${this._escapeHtml(post.authorName || "Unknown")}</p>
                    <p><strong>Blog:</strong> <a href="${this._toBlogLink(resolvedBlogSlug)}">${this._escapeHtml(post.blogTitle || resolvedBlogSlug)}</a></p>
                    <div class="farmlog-markdown-snippet">${snippetHtml}</div>
                    <p><strong>Created:</strong> ${this._formatDate(post.createdAt)}</p>
                    ${this._renderPostEngagementActions(post, resolvedBlogSlug, {
                      showPeriodBadge: true,
                      period: this.topPostsPeriod,
                    })}
                  </article>
                `;
              })
              .join("")
          : `<p class='farmlog-empty'>No most-liked posts found for the last ${this._escapeHtml(this._getPeriodLabel(this.topPostsPeriod))}.</p>`;
      }
    }
  }

  _showSkeletonLoaders() {
    const blogsPanel = document.getElementById("searchBlogsResults");
    const postsPanel = document.getElementById("searchPostsResults");
    const topPostsPanel = document.getElementById("searchTopPostsResults");

    if (blogsPanel) {
      blogsPanel.classList.add("is-loading");
      blogsPanel.innerHTML = this._generateSkeletonCards(3);
    }

    if (postsPanel) {
      postsPanel.classList.add("is-loading");
      postsPanel.innerHTML = this._generateSkeletonCards(3);
    }

    if (topPostsPanel && this.farmlogEngagementEnabled) {
      topPostsPanel.classList.add("is-loading");
      topPostsPanel.innerHTML = this._generateSkeletonCards(3);
    }
  }

  _hideSkeletonLoaders() {
    const blogsPanel = document.getElementById("searchBlogsResults");
    const postsPanel = document.getElementById("searchPostsResults");
    const topPostsPanel = document.getElementById("searchTopPostsResults");

    if (blogsPanel) {
      blogsPanel.classList.remove("is-loading");
    }

    if (postsPanel) {
      postsPanel.classList.remove("is-loading");
    }

    if (topPostsPanel) {
      topPostsPanel.classList.remove("is-loading");
    }
  }

  _generateSkeletonCards(count = 3) {
    let html = "";
    for (let i = 0; i < count; i++) {
      html += `
        <div class="farmlog-skeleton-card">
          <div class="farmlog-skeleton farmlog-skeleton-title"></div>
          <div class="farmlog-skeleton farmlog-skeleton-text"></div>
          <div class="farmlog-skeleton farmlog-skeleton-text"></div>
          <div class="farmlog-skeleton farmlog-skeleton-text"></div>
        </div>
      `;
    }
    return html;
  }
}

class FarmlogBlogDetailPage extends FarmlogBasePage {
  constructor() {
    super();
    this.blog = null;
    this.posts = [];
    this.postsPageSize = 5;
    this.postsPage = 1;
    this.sortBy = "newest";
    this.activeTab = "blog";
    this.isOwner = false;
    this.editingPostSlug = null;
  }

  requiresAuthentication() {
    return false;
  }

  async onReady() {
    const blogSlug = this._getQueryParam("blog");
    if (!blogSlug) {
      this._setStatus("Missing blog slug in URL.", true);
      return;
    }

    this.blogSlug = blogSlug;
    this._bindEvents();
    await this._loadData();
  }

  _bindEvents() {
    const tabs = document.querySelectorAll("[data-blog-tab]");
    const sortEl = document.getElementById("blogPostsSort");
    const createForm = document.getElementById("createBlogPostForm");
    const editForm = document.getElementById("editBlogPostForm");
    const cancelEditBtn = document.getElementById("cancelEditBlogPost");
    const blogHeader = document.getElementById("blogDetailHeader");

    tabs.forEach((button) => {
      button.addEventListener("click", () => {
        this.activeTab = button.getAttribute("data-blog-tab") || "blog";
        this._renderTabs();
      });
    });

    if (sortEl) {
      const mostLikedOption = sortEl.querySelector('option[value="most-liked"]');
      if (mostLikedOption) {
        mostLikedOption.hidden = !this.farmlogEngagementEnabled;
        try {
          if (!this.farmlogEngagementEnabled) {
            mostLikedOption.style.setProperty("display", "none", "important");
          } else {
            mostLikedOption.style.removeProperty("display");
          }
        } catch (err) {
          // ignore style issues
        }
      }

      sortEl.addEventListener("change", () => {
        this.sortBy = sortEl.value;
        this.postsPage = 1;
        this._renderPosts();
      });
    }

    if (createForm) {
      createForm.addEventListener("submit", (event) => this._handleCreatePost(event));
    }

    if (editForm) {
      editForm.addEventListener("submit", (event) => this._handleEditPostSubmit(event));
    }

    if (cancelEditBtn) {
      cancelEditBtn.addEventListener("click", () => this._cancelEditingPost());
    }

    const pagination = document.getElementById("blogPostsPagination");
    if (pagination) {
      pagination.addEventListener("click", (event) => {
        const target = event.target;
        if (!target || !(target instanceof HTMLButtonElement)) {
          return;
        }
        const page = Number(target.getAttribute("data-page"));
        if (!Number.isFinite(page) || page < 1) {
          return;
        }
        this.postsPage = page;
        this._renderPosts();
      });
    }

    const postList = document.getElementById("blogPostsList");
    if (postList) {
      postList.addEventListener("click", (event) => this._handlePostListAction(event));
    }

    if (blogHeader) {
      blogHeader.addEventListener("click", (event) => this._handleHeaderAction(event));
    }

    this._bindMarkdownPreview("createBlogPostContent", "createBlogPostPreview");
    this._bindMarkdownPreview("editBlogPostContent", "editBlogPostPreview");
  }

  async _loadData() {
    this._setStatus("Loading blog details...");
    this._setDetailLoadingState(true);

    try {
      const blogResponse = await this.apiService.get(`blogs/${this.blogSlug}`, { requiresAuth: true });
      if (!blogResponse.success) {
        this._setStatus(blogResponse.error || "Blog not found.", true);
        return;
      }

      this.blog = blogResponse.data?.data || null;
      this.isOwner = !!this.isAuthenticated && !!this.blog && String(this.blog.userId) === String(this._getCurrentUserId());

      const postsResponse = await this.apiService.get(`blogs/${this.blogSlug}/posts`, { requiresAuth: true });
      if (!postsResponse.success) {
        this._setStatus(postsResponse.error || "Unable to load posts.", true);
        return;
      }

      this.posts = Array.isArray(postsResponse.data?.data) ? postsResponse.data.data : [];
      if (this.editingPostSlug && !this.posts.some((post) => post.slug === this.editingPostSlug)) {
        this.editingPostSlug = null;
      }

      this._renderHeader();
      this._renderTabs();
      this._renderPosts();
      this._renderEditPanel();
      this._setStatus("");
    } catch (error) {
      this._setStatus("Unable to load blog details.", true);
    } finally {
      this._setDetailLoadingState(false);
    }
  }

  _renderHeader() {
    const container = document.getElementById("blogDetailHeader");
    if (!container || !this.blog) {
      return;
    }

    const tags = Array.isArray(this.blog.tags) && this.blog.tags.length ? this.blog.tags.join(", ") : "-";
    const visibilityLabel = this.blog.visibility === "public" ? "Public blog" : "Private blog";
    const postCount = this.posts.length;
    const updatedAt = this.blog.updatedAt || this.blog.createdAt;
    const favoriteAction = this.farmlogEngagementEnabled
      ? this._renderFavoriteButton({
          targetType: "blog",
          blogSlug: this.blog.slug,
          isActive: this.blog.favoritedByCurrentUser === true,
          label: this.blog.favoritedByCurrentUser === true ? "Favorited blog" : "Favorite blog",
        })
      : "";

    container.innerHTML = `
      <div class="farmlog-blog-hero__card">
        <div class="farmlog-blog-hero__top">
          <div>
            <p class="farmlog-blog-hero__eyebrow">Blog overview</p>
            <h1>${this._escapeHtml(this.blog.title)}</h1>
            <p class="farmlog-blog-hero__subtitle">By ${this._escapeHtml(this.blog.authorName || "Unknown")}</p>
          </div>
          <div class="farmlog-blog-hero__badges">
            <span class="farmlog-pill farmlog-blog-hero__pill">${this._escapeHtml(visibilityLabel)}</span>
            <span class="farmlog-pill farmlog-blog-hero__pill">${postCount} post${postCount === 1 ? "" : "s"}</span>
          </div>
        </div>

        <div class="farmlog-blog-hero__meta-row">
          <div class="farmlog-blog-hero__meta-item">
            <span>Slug</span>
            <strong>${this._escapeHtml(this.blog.slug)}</strong>
          </div>
          <div class="farmlog-blog-hero__meta-item">
            <span>Author</span>
            <strong>${this._escapeHtml(this.blog.authorName || "Unknown")}</strong>
          </div>
          <div class="farmlog-blog-hero__meta-item">
            <span>Visibility</span>
            <strong>${this._escapeHtml(this.blog.visibility)}</strong>
          </div>
          <div class="farmlog-blog-hero__meta-item">
            <span>Created</span>
            <strong>${this._formatDate(this.blog.createdAt)}</strong>
          </div>
          <div class="farmlog-blog-hero__meta-item">
            <span>Updated</span>
            <strong>${this._formatDate(updatedAt)}</strong>
          </div>
        </div>

        <div class="farmlog-blog-hero__tag-row">
          <span class="farmlog-blog-hero__tag-label">Tags</span>
          <div class="farmlog-blog-hero__tags">
            ${
              tags !== "-"
                ? tags
                    .split(", ")
                    .map((tag) => `<span class="farmlog-pill farmlog-blog-hero__tag">${this._escapeHtml(tag)}</span>`)
                    .join("")
                : '<span class="farmlog-blog-hero__tag-empty">No tags added yet.</span>'
            }
          </div>
        </div>

        <div class="farmlog-blog-hero__actions">
          <a class="btn btn-compact btn-outline" href="/farmlog.html"><i class="fas fa-arrow-left"></i> Back to hub</a>
          <a class="btn btn-compact btn-futuristic" href="#blogPostsPanel"><i class="fas fa-angles-down"></i> Jump to posts</a>
          ${favoriteAction}
        </div>
      </div>
    `;

    container.classList.remove("is-loading");

    const ownerBadge = document.getElementById("ownerActionsBadge");
    if (ownerBadge) {
      ownerBadge.hidden = !this.isOwner;
    }

    const createPanel = document.getElementById("createBlogPostPanel");
    if (createPanel) {
      createPanel.hidden = !this.isOwner;
    }

    const editPanel = document.getElementById("editBlogPostPanel");
    if (editPanel && !this.isOwner) {
      editPanel.hidden = true;
    }
  }

  _renderTabs() {
    const tabs = document.querySelectorAll("[data-blog-tab]");
    const infoPanel = document.getElementById("blogInfoPanel");
    const postsPanel = document.getElementById("blogPostsPanel");

    tabs.forEach((button) => {
      const tab = button.getAttribute("data-blog-tab");
      const isActive = tab === this.activeTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    if (infoPanel) {
      infoPanel.hidden = this.activeTab !== "blog";
    }

    if (postsPanel) {
      postsPanel.hidden = this.activeTab !== "posts";
    }

    if (this.activeTab === "blog") {
      this._renderInfoPanel();
    }
  }

  _renderInfoPanel() {
    const infoPanel = document.getElementById("blogInfoPanel");

    if (!infoPanel || !this.blog) {
      return;
    }

    const tags = Array.isArray(this.blog.tags) && this.blog.tags.length ? this.blog.tags : [];
    const postCount = this.posts.length;
    const visibilityLabel = this.blog.visibility === "public" ? "Public blog" : "Private blog";
    const ownerLabel = this.isOwner ? "Owner tools enabled" : "Read-only mode";
    const route = `/farmlog-blog.html?blog=${encodeURIComponent(this.blog.slug)}`;
    const openPostsText = postCount === 1 ? "1 post ready" : `${postCount} posts ready`;

    infoPanel.innerHTML = `
      <div class="farmlog-blog-info__card">
        <div class="farmlog-blog-info__hero">
          <div>
            <p class="farmlog-blog-info__eyebrow">Blog metadata</p>
            <h2>${this._escapeHtml(this.blog.title)}</h2>
          </div>
          <div class="farmlog-blog-info__badges">
            <span class="farmlog-pill farmlog-blog-info__pill">${this._escapeHtml(visibilityLabel)}</span>
            <span class="farmlog-pill farmlog-blog-info__pill">${this._escapeHtml(openPostsText)}</span>
            <span class="farmlog-pill farmlog-blog-info__pill">${this._escapeHtml(ownerLabel)}</span>
          </div>
        </div>

        <dl class="farmlog-blog-info__meta">
          <div class="farmlog-blog-info__meta-item">
            <dt>Slug</dt>
            <dd>${this._escapeHtml(this.blog.slug)}</dd>
          </div>
          <div class="farmlog-blog-info__meta-item">
            <dt>Visibility</dt>
            <dd>${this._escapeHtml(this.blog.visibility)}</dd>
          </div>
          <div class="farmlog-blog-info__meta-item">
            <dt>Author</dt>
            <dd>${this._escapeHtml(this.blog.authorName || "Unknown")}</dd>
          </div>
          <div class="farmlog-blog-info__meta-item">
            <dt>Created</dt>
            <dd>${this._formatDate(this.blog.createdAt)}</dd>
          </div>
          <div class="farmlog-blog-info__meta-item">
            <dt>Updated</dt>
            <dd>${this._formatDate(this.blog.updatedAt || this.blog.createdAt)}</dd>
          </div>
          <div class="farmlog-blog-info__meta-item farmlog-blog-info__meta-item--wide">
            <dt>Tags</dt>
            <dd>${tags.length ? tags.map((tag) => this._escapeHtml(tag)).join(", ") : "No tags added yet."}</dd>
          </div>
          <div class="farmlog-blog-info__meta-item farmlog-blog-info__meta-item--wide">
            <dt>Route</dt>
            <dd><a href="${route}">${this._escapeHtml(route)}</a></dd>
          </div>
        </dl>

        <div class="farmlog-blog-info__note">
          <i class="fas fa-sparkles"></i>
          <div>
            <strong>${this.isOwner ? "Owner workflow available." : "Viewing as a reader."}</strong>
            <p>${this.isOwner ? "Switch to the Posts tab to create, edit, or remove posts for this blog." : "Switch to the Posts tab to browse entries and open individual posts."}</p>
          </div>
        </div>
      </div>
    `;

    infoPanel.classList.remove("is-loading");
  }

  _getSortedPosts() {
    const sorted = [...this.posts];

    if (this.sortBy === "oldest") {
      sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (this.sortBy === "most-liked" && this.farmlogEngagementEnabled) {
      sorted.sort((a, b) => {
        const likesDelta = Number(b.likesCount || 0) - Number(a.likesCount || 0);
        if (likesDelta !== 0) return likesDelta;

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } else if (this.sortBy === "title-asc") {
      sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    } else if (this.sortBy === "title-desc") {
      sorted.sort((a, b) => String(b.title || "").localeCompare(String(a.title || "")));
    } else {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return sorted;
  }

  _renderPosts() {
    const listEl = document.getElementById("blogPostsList");
    const paginationEl = document.getElementById("blogPostsPagination");

    if (!listEl || !paginationEl || !this.blog) {
      return;
    }

    listEl.classList.remove("is-loading");
    listEl.setAttribute("aria-busy", "false");

    const sorted = this._getSortedPosts();
    const totalPages = Math.max(1, Math.ceil(sorted.length / this.postsPageSize));
    if (this.postsPage > totalPages) {
      this.postsPage = totalPages;
    }

    const offset = (this.postsPage - 1) * this.postsPageSize;
    const currentPagePosts = sorted.slice(offset, offset + this.postsPageSize);

    listEl.innerHTML = currentPagePosts.length
      ? currentPagePosts
          .map((post) => {
            const preview = this._renderMarkdownWithLimit(post.content || "", 200);
            const reactionMarkup = this._renderPostEngagementActions(post, this.blog.slug);
            const ownerActions = this.isOwner
              ? `
                <button class="btn btn-compact btn-outline" data-action="edit" data-post="${this._escapeHtml(post.slug)}">${this.editingPostSlug === post.slug ? "Editing" : "Edit"}</button>
                <button class="btn btn-compact btn-outline" data-action="delete" data-post="${this._escapeHtml(post.slug)}">Delete</button>
              `
              : "";

            return `
              <article class="farmlog-result-card">
                <h3><a href="${this._toPostLink(this.blog.slug, post.slug)}">${this._escapeHtml(post.title)}</a></h3>
                <div class="farmlog-markdown-snippet">${preview}</div>
                <p><strong>Author:</strong> ${this._escapeHtml(post.authorName || "Unknown")}</p>
                <p><strong>Created:</strong> ${this._formatDate(post.createdAt)}</p>
                ${reactionMarkup}
                <div class="farmlog-inline-actions">${ownerActions}</div>
                <a class="btn btn-compact btn-outline" href="${this._toPostLink(this.blog.slug, post.slug)}">Read more</a>
              </article>
            `;
          })
          .join("")
      : "<p class='farmlog-empty'>No posts yet.</p>";

    const buttons = [];
    for (let i = 1; i <= totalPages; i += 1) {
      buttons.push(
        `<button class="btn btn-compact ${i === this.postsPage ? "btn-futuristic" : "btn-outline"}" data-page="${i}">${i}</button>`,
      );
    }
    paginationEl.innerHTML = buttons.join("");
  }

  async _handleCreatePost(event) {
    event.preventDefault();
    if (!this.isOwner || !this.blog) {
      this._setStatus("Only the blog owner can create posts.", true);
      return;
    }

    const titleEl = document.getElementById("createBlogPostTitle");
    const contentEl = document.getElementById("createBlogPostContent");

    const payload = {
      title: (titleEl?.value || "").trim(),
      content: (contentEl?.value || "").trim(),
    };

    if (!payload.title || !payload.content) {
      this._setStatus("Post title and content are required.", true);
      return;
    }

    const response = await this.apiService.post(`blogs/${this.blog.slug}/posts`, payload, { requiresAuth: true });

    if (!response.success) {
      this._setStatus(response.error || "Failed to create post.", true);
      return;
    }

    if (titleEl) titleEl.value = "";
    if (contentEl) contentEl.value = "";

    const previewEl = document.getElementById("createBlogPostPreview");
    if (previewEl) {
      previewEl.innerHTML = this._renderMarkdownWithLimit("", null);
    }

    this._setStatus("Post created.");
    this._cancelEditingPost(false);
    await this._loadData();
    this.activeTab = "posts";
    this._renderTabs();
  }

  async _handleHeaderAction(event) {
    const button = event.target.closest("[data-engagement-action]");
    if (!button) {
      return;
    }

    event.preventDefault();

    const previousTab = this.activeTab;
    const updatedEntity = await this._performEngagementRequest(button);
    if (!updatedEntity) {
      return;
    }

    await this._runWithPreservedScroll(async () => {
      await this._loadData();
      this.activeTab = previousTab;
      this._renderTabs();
    });
  }

  async _handlePostListAction(event) {
    const target = event.target.closest("button");
    if (!target || !(target instanceof HTMLButtonElement) || !this.blog) {
      return;
    }

    if (target.hasAttribute("data-engagement-action")) {
      event.preventDefault();

      const previousTab = this.activeTab;
      const updatedEntity = await this._performEngagementRequest(target);
      if (!updatedEntity) {
        return;
      }

      await this._runWithPreservedScroll(async () => {
        await this._loadData();
        this.activeTab = previousTab;
        this._renderTabs();
      });
      return;
    }

    const action = target.getAttribute("data-action");
    const postSlug = target.getAttribute("data-post");

    if (!action || !postSlug || !this.isOwner) {
      return;
    }

    if (action === "delete") {
      const confirmed = await showConfirmationModal({
        title: "Delete Post",
        message: "Are you sure you want to permanently delete this post? This action cannot be undone.",
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (!confirmed) {
        return;
      }

      const response = await this.apiService.delete(`blogs/${this.blog.slug}/posts/${postSlug}`, {
        requiresAuth: true,
      });

      if (!response.success) {
        this._setStatus(response.error || "Failed to delete post.", true);
        return;
      }

      this._setStatus("Post deleted.");
      this._cancelEditingPost(false);
      await this._loadData();
      this.activeTab = "posts";
      this._renderTabs();
      return;
    }

    if (action === "edit") {
      this._startEditingPost(postSlug);
      this.activeTab = "posts";
      this._renderTabs();
    }
  }

  _startEditingPost(postSlug) {
    const post = this.posts.find((item) => item.slug === postSlug);
    if (!post) {
      this._setStatus("Post not found.", true);
      return;
    }

    this.editingPostSlug = postSlug;
    this._renderPosts();
    this._renderEditPanel();
    this._setStatus("");
  }

  _cancelEditingPost(updateStatus = true) {
    this.editingPostSlug = null;
    this._renderPosts();
    this._renderEditPanel();
    if (updateStatus) {
      this._setStatus("Post editing canceled.");
    }
  }

  _renderEditPanel() {
    const panel = document.getElementById("editBlogPostPanel");
    const titleEl = document.getElementById("editBlogPostTitle");
    const contentEl = document.getElementById("editBlogPostContent");
    const previewEl = document.getElementById("editBlogPostPreview");

    if (!panel || !titleEl || !contentEl || !previewEl || !this.isOwner || !this.blog) {
      if (panel) {
        panel.hidden = true;
      }
      return;
    }

    if (!this.editingPostSlug) {
      panel.hidden = true;
      titleEl.value = "";
      contentEl.value = "";
      previewEl.innerHTML = this._renderMarkdownWithLimit("", null);
      return;
    }

    const post = this.posts.find((item) => item.slug === this.editingPostSlug);
    if (!post) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    titleEl.value = post.title || "";
    contentEl.value = post.content || "";
    previewEl.innerHTML = this._renderMarkdownWithLimit(contentEl.value, null);
  }

  async _handleEditPostSubmit(event) {
    event.preventDefault();

    if (!this.isOwner || !this.blog || !this.editingPostSlug) {
      this._setStatus("Select a post to edit first.", true);
      return;
    }

    const titleEl = document.getElementById("editBlogPostTitle");
    const contentEl = document.getElementById("editBlogPostContent");

    const payload = {
      title: (titleEl?.value || "").trim(),
      content: (contentEl?.value || "").trim(),
    };

    if (!payload.title || !payload.content) {
      this._setStatus("Post title and content are required.", true);
      return;
    }

    const response = await this.apiService.request("PATCH", `blogs/${this.blog.slug}/posts/${this.editingPostSlug}`, {
      requiresAuth: true,
      body: payload,
    });

    if (!response.success) {
      this._setStatus(response.error || "Failed to update post.", true);
      return;
    }

    this._setStatus("Post updated.");
    await this._loadData();
    this.activeTab = "posts";
    this._renderTabs();
  }
}

class FarmlogPostDetailPage extends FarmlogBasePage {
  constructor() {
    super();
    this.blog = null;
    this.post = null;
    this.blogSlug = null;
    this.postSlug = null;
  }

  requiresAuthentication() {
    return false;
  }

  async onReady() {
    const blogSlug = this._getQueryParam("blog");
    const postSlug = this._getQueryParam("post");

    if (!blogSlug || !postSlug) {
      this._setStatus("Missing blog or post slug in URL.", true);
      return;
    }

    this.blogSlug = blogSlug;
    this.postSlug = postSlug;
    this._bindEvents();
    await this._loadPostData();
  }

  _bindEvents() {
    const actionsEl = document.getElementById("postDetailActions");
    if (actionsEl) {
      actionsEl.addEventListener("click", (event) => this._handleActionClick(event));
    }
  }

  async _loadPostData() {
    this._setStatus("Loading post...");

    const [blogResponse, postResponse] = await Promise.all([
      this.apiService.get(`blogs/${this.blogSlug}`, { requiresAuth: true }),
      this.apiService.get(`blogs/${this.blogSlug}/posts/${this.postSlug}`, { requiresAuth: true }),
    ]);

    if (!blogResponse.success || !postResponse.success) {
      this._setStatus("Unable to load this post.", true);
      return;
    }

    this.blog = blogResponse.data?.data || null;
    this.post = postResponse.data?.data || null;
    this._renderPostDetail();
    this._setStatus("");
  }

  _renderPostDetail() {
    const titleEl = document.getElementById("postDetailTitle");
    const metaEl = document.getElementById("postDetailMeta");
    const actionsEl = document.getElementById("postDetailActions");
    const contentEl = document.getElementById("postDetailContent");
    const backEl = document.getElementById("postDetailBackLink");

    if (titleEl) {
      titleEl.innerHTML = `<i class="fas fa-file-lines"></i> ${this._escapeHtml(this.post?.title || "Untitled")}`;
    }

    if (metaEl) {
      metaEl.innerHTML = `
        <p><strong>Blog:</strong> ${this._escapeHtml(this.blog?.title || this.blogSlug || "-")}</p>
        <p><strong>Published:</strong> ${this._formatDate(this.post?.createdAt)}</p>
        <p><strong>Updated:</strong> ${this._formatDate(this.post?.updatedAt)}</p>
      `;
    }

    if (actionsEl) {
      actionsEl.innerHTML = this.farmlogEngagementEnabled
        ? this._renderPostEngagementActions(this.post, this.blog?.slug || this.blogSlug)
        : "";
      actionsEl.hidden = !this.farmlogEngagementEnabled;
    }

    if (contentEl) {
      contentEl.innerHTML = this._renderMarkdown(this.post?.content || "");
    }

    if (backEl && this.blog?.slug) {
      backEl.href = this._toBlogLink(this.blog.slug);
    }
  }

  async _handleActionClick(event) {
    const button = event.target.closest("[data-engagement-action]");
    if (!button) {
      return;
    }

    event.preventDefault();

    const updatedEntity = await this._performEngagementRequest(button);
    if (!updatedEntity) {
      return;
    }

    await this._runWithPreservedScroll(() => this._loadPostData());
  }
}

window.FarmlogHubPage = FarmlogHubPage;
window.FarmlogBlogDetailPage = FarmlogBlogDetailPage;
window.FarmlogPostDetailPage = FarmlogPostDetailPage;
