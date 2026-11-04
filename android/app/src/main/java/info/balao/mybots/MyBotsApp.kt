package info.balao.mybots

import android.app.Application
import android.webkit.CookieManager

class MyBotsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Aceita cookie antes de qualquer WebView, para a sessão do login
        // sobreviver ao processo reiniciar.
        CookieManager.getInstance().setAcceptCookie(true)
    }
}
