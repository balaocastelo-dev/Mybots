package info.balao.mybots

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EnderecoTest {
    @Test
    fun abreOPainelPublico() {
        assertEquals("https://www.balao.info/mybots", Endereco.INICIO)
    }

    @Test
    fun ficaNoDominioDaCasa() {
        assertTrue(Endereco.hostInterno("www.balao.info"))
        assertTrue(Endereco.hostInterno("balao.info"))
        assertTrue(Endereco.hostInterno("painel.balao.info"))
        assertTrue(Endereco.hostInterno("WWW.BALAO.INFO"))
    }

    @Test
    fun linkDeForaSaiDoApp() {
        assertFalse(Endereco.hostInterno(null))
        assertFalse(Endereco.hostInterno(""))
        assertFalse(Endereco.hostInterno("balao.info.evil.com"))
        assertFalse(Endereco.hostInterno("evilbalao.info"))
        assertFalse(Endereco.hostInterno("www.balao.info.evil.com"))
        assertFalse(Endereco.hostInterno("google.com"))
        assertFalse(Endereco.hostInterno("user@balao.info"))
    }
}
