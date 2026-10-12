package com.thegrizzlylabs.sardineandroid.impl;

import java.io.IOException;

/**
 * WebDAV 请求失败（非 2xx）时抛出的异常 —— 与上游 sardine-android 同名同语义。
 *
 * ★ 它是 {@link IOException} 的子类，所以 wex 里 `catch (Exception)` /
 *   上游库调用方按 IOException 捕获的代码都能正常接住。
 * ★ 消息里带状态码与原因短语：wex 配置中心网页会把异常 message 直接显示给用户，
 *   "Error contacting http://… (401 Unauthorized)" 远比裸 IOException 有用。
 */
public class SardineException extends IOException {

    private static final long serialVersionUID = 1L;

    private final int statusCode;
    private final String responsePhrase;

    public SardineException(String message, int statusCode, String responsePhrase) {
        super(message + " (" + statusCode + " " + responsePhrase + ")");
        this.statusCode = statusCode;
        this.responsePhrase = responsePhrase;
    }

    public int getStatusCode() {
        return this.statusCode;
    }

    public String getResponsePhrase() {
        return this.responsePhrase;
    }
}
