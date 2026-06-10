<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<#import "social-providers.ftl" as identityProviders>
<#--
    Platform login theme (ADR-ACT-0157). This is the stock keycloak.v2 login.ftl with ONE
    addition: keep Keycloak invisible for brokered-IdP failures. A denied / cancelled /
    provider-error / disabled brokered login comes back to Keycloak as a global error that
    mentions the upstream provider, and Keycloak falls back to this login page. Detect that
    and bounce the browser to the app's own /login?authError=signin_failed instead of
    showing the Keycloak page.

    A plain credential error ("Invalid username or password") is a per-field error, not a
    global "authenticating with …" message, so direct platform username/password login
    still renders the normal themed form (with its inline error). en-text match — the
    platform ships en-GB only.
-->
<#assign isBrokerError = (message?has_content && message.type == 'error'
    && (message.summary?contains("authenticating with") || message.summary?contains("identity provider")))>
<@layout.registrationLayout displayMessage=!isBrokerError && !messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <#if isBrokerError>
            <script type="text/javascript">window.location.replace("/login?authError=signin_failed");</script>
            <meta http-equiv="refresh" content="0; url=/login?authError=signin_failed"/>
            <p>${msg("loginAccountTitle")}…</p>
        <#else>
        <div id="kc-form">
          <div id="kc-form-wrapper">
            <#if realm.password>
                <form id="kc-form-login" class="${properties.kcFormClass!}" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post" novalidate="novalidate">
                    <#if !usernameHidden??>
                        <#assign label>
                            <#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if>
                        </#assign>
                        <@field.input name="username" label=label error=kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc autofocus=true autocomplete="username" value=login.username!'' />
                        <@field.password name="password" label=msg("password") error="" forgotPassword=realm.resetPasswordAllowed autofocus=usernameHidden?? autocomplete="current-password">
                            <#if realm.rememberMe && !usernameHidden??>
                                <@field.checkbox name="rememberMe" label=msg("rememberMe") value=login.rememberMe?? />
                            </#if>
                        </@field.password>
                    <#else>
                        <@field.password name="password" label=msg("password") forgotPassword=realm.resetPasswordAllowed autofocus=usernameHidden?? autocomplete="current-password">
                            <#if realm.rememberMe && !usernameHidden??>
                                <@field.checkbox name="rememberMe" label=msg("rememberMe") value=login.rememberMe?? />
                            </#if>
                        </@field.password>
                    </#if>

                    <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                    <@buttons.loginButton />
                </form>
            </#if>
            </div>
        </div>
        </#if>
    <#elseif section = "socialProviders" >
        <#if !isBrokerError && realm.password && social.providers?? && social.providers?has_content>
            <@identityProviders.show social=social/>
        </#if>
    <#elseif section = "info" >
        <#if !isBrokerError && realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>${msg("noAccount")} <a href="${url.registrationUrl}">${msg("doRegister")}</a></span>
                </div>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
