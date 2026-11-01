package info.balao.mybots

/**
 * O app só abre o painel público. Não fala com o Hub na rede local
 * e não usa porta de servidor nenhum.
 */
internal object Endereco {
    const val INICIO = "https://www.balao.info/mybots"

    fun hostInterno(host: String?): Boolean {
        val limpo = host?.lowercase()?.trim()?.trimEnd('.') ?: return false
        if (limpo.isEmpty() || limpo.contains('@')) return false
        return limpo == "balao.info" || limpo.endsWith(".balao.info")
    }
}
