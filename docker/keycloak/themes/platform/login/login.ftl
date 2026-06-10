<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "form">
        <#--
            Keep Keycloak invisible for brokered-IdP failures. When a brokered login
            (Google / Microsoft / Apple) is denied, cancelled, errors, or hits a disabled
            account, Keycloak falls back to *this* login page with an error that mentions
            the upstream provider. Detect that and bounce the browser to the app's own
            /login?authError=… instead of showing the Keycloak page. (ADR-ACT-0157)

            Discriminator: brokered-IdP error summaries contain "authenticating with" /
            "identity provider"; a plain credential error ("Invalid username or password")
            does NOT — so direct platform username/password login still renders inline with
            its error. The platform ships en-GB only, so matching the en text is safe.
        -->
        <#assign isBrokerError = (message?has_content && message.type == 'error'
            && (message.summary?contains("authenticating with") || message.summary?contains("identity provider")))>
        <#if isBrokerError>
            <script type="text/javascript">
                window.location.replace("/login?authError=signin_failed");
            </script>
            <meta http-equiv="refresh" content="0; url=/login?authError=signin_failed"/>
            <p>Redirecting to sign-in…</p>
        <#else>
            <#if message?has_content && message.type == 'error'>
                <div id="kc-error-message" class="alert alert-error">
                    <span class="kc-feedback-text">${kcSanitize(message.summary)?no_esc}</span>
                </div>
            </#if>
            <form id="kc-form-login" action="${url.loginAction}" method="post">
                <div class="${properties.kcFormGroupClass!}">
                    <label for="username" class="${properties.kcLabelClass!}">${msg("usernameOrEmail")}</label>
                    <input id="username" name="username" value="${(login.username!'')}" type="text"
                           autofocus autocomplete="username" class="${properties.kcInputClass!}"/>
                </div>
                <div class="${properties.kcFormGroupClass!}">
                    <label for="password" class="${properties.kcLabelClass!}">${msg("password")}</label>
                    <input id="password" name="password" type="password"
                           autocomplete="current-password" class="${properties.kcInputClass!}"/>
                </div>
                <#if auth?has_content && auth.selectedCredential?has_content>
                    <input type="hidden" id="id-hidden-input" name="credentialId" value="${auth.selectedCredential}"/>
                </#if>
                <div class="${properties.kcFormGroupClass!}">
                    <input name="login" id="kc-login" type="submit"
                           class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}"
                           value="${msg("doLogIn")}"/>
                </div>
            </form>
        </#if>
    </#if>
</@layout.registrationLayout>
