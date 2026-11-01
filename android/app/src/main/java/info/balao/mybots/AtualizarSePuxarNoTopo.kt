package info.balao.mybots

import android.content.Context
import android.util.AttributeSet
import android.view.MotionEvent
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * A conversa rola dentro da página (o body fica travado). Um refresh comum
 * roubaria esse gesto. Aqui só o puxão que começa na faixa de cima vira recarregar.
 */
class AtualizarSePuxarNoTopo @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : SwipeRefreshLayout(context, attrs) {

    private val faixaSuperiorPx = 56f * resources.displayMetrics.density
    private var comecouNoTopo = false

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
            comecouNoTopo = ev.y <= faixaSuperiorPx
        }
        if (!comecouNoTopo) return false
        return super.onInterceptTouchEvent(ev)
    }
}
