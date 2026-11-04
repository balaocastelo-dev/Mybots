# A casca não ofusca o debug. O release, se alguém ligar o minify, precisa
# manter o WebView e o gerenciador de cookies.
-keep class android.webkit.** { *; }
