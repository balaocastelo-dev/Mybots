package info.balao.mybots

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.appbar.MaterialToolbar

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var atualizar: SwipeRefreshLayout
    private lateinit var erro: android.view.View
    private var falhou = false
    private var seletorArquivo: ValueCallback<Array<Uri>>? = null
    private var downloadPendente: PedidoDownload? = null

    private val pedirArquivo = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { resultado ->
        val callback = seletorArquivo
        seletorArquivo = null
        callback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(resultado.resultCode, resultado.data),
        )
    }

    private val pedirArmazenamento = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { concedida ->
        val pedido = downloadPendente
        downloadPendente = null
        if (pedido == null) return@registerForActivityResult
        if (concedida) enfileirar(pedido) else avisar(R.string.sem_permissao_arquivo)
    }

    private val pedirNotificacao = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* o aviso é extra; o arquivo já foi para a fila */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        val controlador = WindowCompat.getInsetsController(window, window.decorView)
        controlador.isAppearanceLightStatusBars = false
        controlador.isAppearanceLightNavigationBars = false

        val raiz = findViewById<android.view.View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(raiz) { view, insets ->
            val barras = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(barras.left, barras.top, barras.right, barras.bottom)
            WindowInsetsCompat.CONSUMED
        }

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.setOnMenuItemClickListener { item ->
            if (item.itemId == R.id.action_recarregar) {
                recarregar()
                true
            } else {
                false
            }
        }

        webView = findViewById(R.id.webview)
        atualizar = findViewById(R.id.atualizar)
        atualizar.setColorSchemeColors(getColor(R.color.acento))
        atualizar.setProgressBackgroundColorSchemeColor(getColor(R.color.barra))
        atualizar.setOnRefreshListener { recarregar() }
        erro = findViewById(R.id.erro)
        findViewById<android.view.View>(R.id.tentar).setOnClickListener { recarregar() }

        configurarWebView(webView)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (this@MainActivity::webView.isInitialized && webView.canGoBack()) {
                        erro.isVisible = false
                        webView.isVisible = true
                        falhou = false
                        webView.goBack()
                        return
                    }
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            },
        )

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        }
        if (webView.url.isNullOrBlank()) {
            webView.loadUrl(Endereco.INICIO)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configurarWebView(vista: WebView) {
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(vista, true)

        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        vista.setBackgroundColor(getColor(R.color.fundo))
        vista.overScrollMode = android.view.View.OVER_SCROLL_NEVER
        vista.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            loadsImagesAutomatically = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        vista.webViewClient = cliente
        vista.webChromeClient = chrome
        vista.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            baixar(url, userAgent, contentDisposition, mimeType)
        }
    }

    private val cliente = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            return abrirSeForFora(request.url)
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            falhou = false
            erro.isVisible = false
            view.isVisible = true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            runCatching { CookieManager.getInstance().flush() }
            pararAtualizacao()
            if (falhou) mostrarErro()
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            if (!request.isForMainFrame) return
            val descricao = error.description?.toString().orEmpty()
            // Um toque que abre o navegador cancela a carga. Isso não é falta de rede.
            if (descricao.contains("ERR_ABORTED", ignoreCase = true)) return
            falhou = true
            mostrarErro()
        }

        override fun onRenderProcessGone(
            view: WebView,
            detail: android.webkit.RenderProcessGoneDetail,
        ): Boolean {
            recriarWebView()
            mostrarErro()
            return true
        }
    }

    private val chrome = object : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            seletorArquivo?.onReceiveValue(null)
            seletorArquivo = filePathCallback
            return try {
                pedirArquivo.launch(fileChooserParams.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                seletorArquivo = null
                avisar(R.string.sem_seletor)
                false
            }
        }

        override fun onCreateWindow(
            view: WebView,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: android.os.Message,
        ): Boolean {
            val transporte = resultMsg.obj as? WebView.WebViewTransport ?: return false
            val temporario = WebView(this@MainActivity)
            temporario.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    popup: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    val destino = request.url
                    if (destino != null && Endereco.hostInterno(destino.host)) {
                        webView.loadUrl(destino.toString())
                    } else if (destino != null) {
                        abrirFora(destino)
                    }
                    popup.destroy()
                    return true
                }
            }
            transporte.webView = temporario
            resultMsg.sendToTarget()
            return true
        }
    }

    private fun abrirSeForFora(uri: Uri?): Boolean {
        if (uri == null) return true
        val esquema = uri.scheme?.lowercase()
        if ((esquema == "https" || esquema == "http") && Endereco.hostInterno(uri.host)) {
            return false
        }
        abrirFora(uri)
        return true
    }

    private fun abrirFora(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            avisar(R.string.sem_app)
        }
    }

    private fun recarregar() {
        falhou = false
        erro.isVisible = false
        webView.isVisible = true
        if (this::atualizar.isInitialized) atualizar.isRefreshing = true
        val atual = webView.url
        if (atual.isNullOrBlank() || atual == "about:blank") {
            webView.loadUrl(Endereco.INICIO)
        } else {
            webView.reload()
        }
    }

    private fun mostrarErro() {
        pararAtualizacao()
        webView.isVisible = false
        erro.isVisible = true
    }

    private fun pararAtualizacao() {
        if (this::atualizar.isInitialized) atualizar.isRefreshing = false
    }

    private fun baixar(
        url: String,
        userAgent: String,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        val uri = runCatching { Uri.parse(url) }.getOrNull()
        val esquema = uri?.scheme?.lowercase()
        if (uri == null || (esquema != "http" && esquema != "https")) {
            avisar(R.string.download_falhou)
            return
        }
        val pedido = PedidoDownload(url, userAgent, contentDisposition, mimeType, uri.host)
        if (
            Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            downloadPendente = pedido
            pedirArmazenamento.launch(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        enfileirar(pedido)
    }

    private fun enfileirar(pedido: PedidoDownload) {
        val nome = nomeArquivo(pedido.url, pedido.contentDisposition, pedido.mimeType)
        val requisicao = DownloadManager.Request(Uri.parse(pedido.url)).apply {
            setMimeType(pedido.mimeType)
            addRequestHeader("User-Agent", pedido.userAgent)
            if (Endereco.hostInterno(pedido.host)) {
                val cookie = CookieManager.getInstance().getCookie(pedido.url)
                if (!cookie.isNullOrEmpty()) addRequestHeader("Cookie", cookie)
            }
            setTitle(nome)
            setDescription(getString(R.string.baixando))
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nome)
            setAllowedOverMetered(true)
            setAllowedOverRoaming(true)
        }
        try {
            getSystemService(DownloadManager::class.java).enqueue(requisicao)
            avisar(R.string.download_iniciado)
            if (
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                pedirNotificacao.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        } catch (_: Exception) {
            avisar(R.string.download_falhou)
        }
    }

    private fun nomeArquivo(url: String, contentDisposition: String?, mimeType: String?): String {
        val bruto = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val limpo = bruto.replace(Regex("""[\\/:*?"<>|]"""), "_").trim().trim('.')
        return limpo.ifBlank { "arquivo" }.take(120)
    }

    private fun recriarWebView() {
        val morto = webView
        val pai = morto.parent as? ViewGroup ?: return
        val indice = pai.indexOfChild(morto)
        val params = morto.layoutParams
        pai.removeView(morto)
        morto.destroy()
        val novo = WebView(this).apply { id = R.id.webview }
        pai.addView(novo, indice.coerceAtLeast(0), params)
        webView = novo
        configurarWebView(novo)
    }

    private fun avisar(mensagem: Int) {
        Toast.makeText(this, mensagem, Toast.LENGTH_LONG).show()
    }

    override fun onPause() {
        runCatching { CookieManager.getInstance().flush() }
        if (this::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (this::webView.isInitialized) webView.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (this::webView.isInitialized) webView.saveState(outState)
    }

    override fun onDestroy() {
        seletorArquivo?.onReceiveValue(null)
        seletorArquivo = null
        if (this::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    private data class PedidoDownload(
        val url: String,
        val userAgent: String,
        val contentDisposition: String?,
        val mimeType: String?,
        val host: String?,
    )
}
