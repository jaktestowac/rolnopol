window.onload = function () {
  //<editor-fold desc="Changeable Configuration Block">

  // Listen for authentication tokens from parent page
  let authToken = null;
  let isLoggedIn = false;

  window.addEventListener("message", (event) => {
    console.log("Swagger received message:", event.data);
    if (event.data.type === "AUTH_TOKEN") {
      authToken = event.data.token;
      isLoggedIn = event.data.isLogged;
      console.log("Swagger received auth token:", {
        hasToken: !!authToken,
        isLoggedIn: isLoggedIn,
        tokenLength: authToken ? authToken.length : 0,
      });
    }
  });

  // the following lines will be replaced by docker/configurator, when it runs in a docker-container
  window.ui = SwaggerUIBundle({
    url: "/schema/openapi.json",
    dom_id: "#swagger-ui",
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    layout: "StandaloneLayout",
    requestInterceptor: (request) => {
      // Add authentication token if available
      if (authToken && isLoggedIn) {
        request.headers.token = authToken;
      }
      return request;
    },
    responseInterceptor: (response) => {
      // Handle authentication errors gracefully
      if (response.status === 401 || response.status === 403) {
        // Send message to parent page about auth error
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(
            {
              type: "AUTH_ERROR",
              message: "Authentication required for this endpoint",
            },
            "*",
          );
        }
      }
      return response;
    },
    onComplete: () => {
      console.log("Swagger UI loaded successfully");
    },
    onFailure: (data) => {
      console.error("Swagger UI failed to load:", data);
    },
  });

  //</editor-fold>
};
