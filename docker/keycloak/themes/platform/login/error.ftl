<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "form">
        <#-- Keep Keycloak invisible: any standalone Keycloak error page bounces back to
             the app's own /login with a friendly code instead of being shown. (ADR-ACT-0157) -->
        <script type="text/javascript">
            window.location.replace("/login?authError=signin_failed");
        </script>
        <meta http-equiv="refresh" content="0; url=/login?authError=signin_failed"/>
        <p>Redirecting to sign-in…</p>
    </#if>
</@layout.registrationLayout>
