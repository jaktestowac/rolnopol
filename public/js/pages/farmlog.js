class FarmlogBasePage {
  constructor() {
    this.authService = null;
    this.apiService = null;
    this.featureFlagsService = null;
    this.currentUser = null;
    this.isAuthenticated = false;
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
    this.blogSlugById = new Map();
    this.activeTab = "blogs";
    this.userBlog = null;
    this.userBlogPosts = [];
    this.hasResolvedUserBlog = false;
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
    this._bindEvents();
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

    if (searchForm) {
      searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this._performSearch();
      });
    }

    tabs.forEach((button) => {
      button.addEventListener("click", () => {
        this.activeTab = button.getAttribute("data-result-tab") || "blogs";
        this._renderSearchResults();
      });
    });

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

    this._bindMarkdownPreview("createUserPostContent", "createUserPostPreview");
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

  async _performSearch() {
    const queryInput = document.getElementById("farmlogSearchInput");
    const query = (queryInput?.value || "").trim();
    const isLoggedIn = !!this._getCurrentUserId();

    this._setStatus("Searching public blogs and posts...");
    this._showSkeletonLoaders();

    const [blogsResponse, postsResponse] = await Promise.all([
      this.apiService.get("blogs/search", { requiresAuth: isLoggedIn, query: { q: query } }),
      this.apiService.get("blogs/posts/search", { requiresAuth: isLoggedIn, query: { q: query } }),
    ]);

    if (!blogsResponse.success || !postsResponse.success) {
      this._setStatus("Search failed. Please try again.", true);
      return;
    }

    this.blogResults = Array.isArray(blogsResponse.data?.data) ? blogsResponse.data.data : [];
    this.postResults = Array.isArray(postsResponse.data?.data) ? postsResponse.data.data : [];

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

    this._hideSkeletonLoaders();

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
              return `
                <article class="farmlog-result-card">
                  <h3><a href="${this._toBlogLink(blog.slug)}">${this._escapeHtml(blog.title)}</a></h3>
                  <p><strong>Author:</strong> ${this._escapeHtml(blog.authorName || "Unknown")}</p>
                  <p><strong>Tags:</strong> ${this._escapeHtml((blog.tags || []).join(", ") || "-")}</p>
                  <p><strong>Created:</strong> ${this._formatDate(blog.createdAt)}</p>
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
              return `
                <article class="farmlog-result-card">
                  <h3><a href="${this._toPostLink(resolvedBlogSlug, post.slug)}">${this._escapeHtml(post.title)}</a></h3>
                  <p><strong>Author:</strong> ${this._escapeHtml(post.authorName || "Unknown")}</p>
                  <p><strong>Blog:</strong> <a href="${this._toBlogLink(resolvedBlogSlug)}">${this._escapeHtml(resolvedBlogSlug)}</a></p>
                  <div class="farmlog-markdown-snippet">${snippetHtml}</div>
                  <p><strong>Created:</strong> ${this._formatDate(post.createdAt)}</p>
                </article>
              `;
            })
            .join("")
        : "<p class='farmlog-empty'>No public posts found.</p>";
    }
  }

  _showSkeletonLoaders() {
    const blogsPanel = document.getElementById("searchBlogsResults");
    const postsPanel = document.getElementById("searchPostsResults");

    if (blogsPanel) {
      blogsPanel.classList.add("is-loading");
      blogsPanel.innerHTML = this._generateSkeletonCards(3);
    }

    if (postsPanel) {
      postsPanel.classList.add("is-loading");
      postsPanel.innerHTML = this._generateSkeletonCards(3);
    }
  }

  _hideSkeletonLoaders() {
    const blogsPanel = document.getElementById("searchBlogsResults");
    const postsPanel = document.getElementById("searchPostsResults");

    if (blogsPanel) {
      blogsPanel.classList.remove("is-loading");
    }

    if (postsPanel) {
      postsPanel.classList.remove("is-loading");
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

    tabs.forEach((button) => {
      button.addEventListener("click", () => {
        this.activeTab = button.getAttribute("data-blog-tab") || "blog";
        this._renderTabs();
      });
    });

    if (sortEl) {
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
      this.isOwner = !!this.isAuthenticated && !!this.blog && this.blog.userId === this._getCurrentUserId();

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

  async _handlePostListAction(event) {
    const target = event.target;
    if (!target || !(target instanceof HTMLButtonElement) || !this.blog) {
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

    this._setStatus("Loading post...");

    const [blogResponse, postResponse] = await Promise.all([
      this.apiService.get(`blogs/${blogSlug}`, { requiresAuth: true }),
      this.apiService.get(`blogs/${blogSlug}/posts/${postSlug}`, { requiresAuth: true }),
    ]);

    if (!blogResponse.success || !postResponse.success) {
      this._setStatus("Unable to load this post.", true);
      return;
    }

    const blog = blogResponse.data?.data;
    const post = postResponse.data?.data;

    const titleEl = document.getElementById("postDetailTitle");
    const metaEl = document.getElementById("postDetailMeta");
    const contentEl = document.getElementById("postDetailContent");
    const backEl = document.getElementById("postDetailBackLink");

    if (titleEl) {
      titleEl.textContent = post?.title || "Untitled";
    }

    if (metaEl) {
      metaEl.innerHTML = `
        <p><strong>Blog:</strong> ${this._escapeHtml(blog?.title || blogSlug)}</p>
        <p><strong>Published:</strong> ${this._formatDate(post?.createdAt)}</p>
        <p><strong>Updated:</strong> ${this._formatDate(post?.updatedAt)}</p>
      `;
    }

    if (contentEl) {
      contentEl.innerHTML = this._renderMarkdown(post?.content || "");
    }

    if (backEl && blog?.slug) {
      backEl.href = this._toBlogLink(blog.slug);
    }

    this._setStatus("");
  }
}

window.FarmlogHubPage = FarmlogHubPage;
window.FarmlogBlogDetailPage = FarmlogBlogDetailPage;
window.FarmlogPostDetailPage = FarmlogPostDetailPage;
