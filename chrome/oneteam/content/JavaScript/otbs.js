var EXPORTED_SYMBOLS = ["socks5Service"];

function SOCKS5Service()
{
}

_DECL_(SOCKS5Service).prototype =
{
    transfers: {},
    transfersBySidHash: {},
    proxies: {},

    registerProxy: function(jid)
    {
        var bsp = new JSJaCIQ();
        bsp.setIQ(jid, "get");
        bsp.setQuery("http://jabber.org/protocol/bytestreams");
        account.connection.send(bsp, new Callback(this._onProxyAddress, this));
    },

    _onProxyAddress: function(pkt)
    {
        var sh = pkt.getNode().getElementsByTagNameNS(
          "http://jabber.org/protocol/bytestreams", "streamhost");

        for (var i = 0; i < sh.length; i++)
            if (sh[i].getAttribute("port")) {
                this.proxies[sh[i].getAttribute("jid")] = {
                    jid: sh[i].getAttribute("jid"),
                    host: sh[i].getAttribute("host"),
                    port: +sh[i].getAttribute("port")
                };
            };
    },

    canReceive: function() {
        for (i in this.proxies)
            return true;

        return false;
    },

    canSendTo: function(contact)
    {
        if (contact == null)
            return false;
        for (var i in this.proxies)
            return true;
        return false;
    },

    sendFile: function(fileTransfer, rangeOffset, rangeLength)
    {
        var bsNS = new Namespace("http://jabber.org/protocol/bytestreams");
        var xml = <query xmlns="http://jabber.org/protocol/bytestreams" mode="tcp"
                     sid={fileTransfer.streamID}/>;

        var token = {
            fileTransfer: fileTransfer,
            sidHash: fileTransfer.sidHash,
            accepted: false
        };

        for (i in this.proxies)
            xml.appendChild(<streamhost host={this.proxies[i].host} jid={i}
                                port={this.proxies[i].port} />);

        var pkt = new JSJaCIQ();
        pkt.setIQ(fileTransfer.jid, "set");
        pkt.getNode().appendChild(E4XtoDOM(xml, pkt.getDoc()));

        account.connection.send(pkt, new Callback(this._sendFileStep, this), token);

        return token;
    },

    abort: function(token)
    {
        token.aborted = true;
        delete this.transfers[token.fileTransfer.streamID];
        if (token.sidHash)
            delete this.transfersBySidHash[token.sidHash];
    },

    _sendFileStep: function(pkt, token)
    {
        if (pkt.getType() != "result") {
            token.fileTransfer.onRejected();
            return;
        }

        var xml = DOMtoE4X(pkt.getNode());
        var bsNS = new Namespace("http://jabber.org/protocol/bytestreams");
        var jid = xml..bsNS::["streamhost-used"].@jid.toString();

        token.proxy = jid;

        var iq = new JSJaCIQ();
        iq.setIQ(jid, "set");
        iq.getNode().appendChild(E4XtoDOM(
            <query xmlns='http://jabber.org/protocol/bytestreams'
                sid={token.fileTransfer.streamID}>
              <activate>{token.fileTransfer.jid}</activate>
              <x xmlns='http://oneteam.im/bs-proxy'/>
            </query>, pkt.getDoc()));

        account.connection.send(iq, new Callback(this._sendFileStep2, this), token);
    },

    _sendFileStep2: function(pkt, token)
    {
        if (pkt.getType() != "result") {
            token.fileTransfer.onTransferFailure();
            return;
        }
        var xml = DOMtoE4X(pkt.getNode());
        var bsNS = new Namespace("http://oneteam.im/bs-proxy");

        token.fileTransfer.form.setAttribute("action", xml..bsNS::activated.@url);
        token.fileTransfer.form.submit();
        token.fileTransfer.onTransferStart();
        this.transfersBySidHash[token.sidHash] = token.fileTransfer;
    },

    recvFile: function(fileTransfer)
    {
        return this.transfers[fileTransfer.streamID] = {
            bytestreams: [],
            fileTransfer: fileTransfer
        }
    },

    onBSIQ: function(pkt, query)
    {
        if (pkt.getType() != "set")
            return;

        var ft = this.transfersBySidHash[query.@sidhash];

        if (query.localName() == "activated") {
            var frame = document.createElementNS("http://www.w3.org/1999/xhtml", "iframe");
            document.getElementById("hiddenContainer").appendChild(frame);
            frame.src = query.@url;
            ft.onTransferCompleted();
            setTimeout(function(a){a.parentNode.removeChild(a)}, 5000, frame);
        } else if (query.localName() == "progress") {
            ft.size = +query.@total;
            ft.onBytestreamProgress(+query.@sent);
        }
    },

    onSocksIQ: function(pkt, query)
    {
        try{
        if (pkt.getType() != "set")
            return;

        var sid = query.@sid.toString();
        var token = this.transfers[sid];

        delete this.transfers[sid];

        if (!token)
            return;

        token.id = pkt.getID();
        token.sidHash = token.fileTransfer.sidHash;

        var node = <connect xmlns='http://oneteam.im/bs-proxy'
            sid={token.fileTransfer.streamID} jid={token.fileTransfer.jid}/>;

        var bsNS = new Namespace("http://jabber.org/protocol/bytestreams");
        for each (var sh in query.bsNS::streamhost) {
            node.* += sh;
        }

        var proxy;
        for each (proxy in this.proxies)
            break;

        var iq = new JSJaCIQ();
        iq.setIQ(proxy.jid, "set");
        iq.getNode().appendChild(E4XtoDOM(node, iq.getDoc()));

        account.connection.send(iq, new Callback(this._recvFileStep, this), token);
        }catch(ex){alert(ex)}
    },

    _recvFileStep: function(pkt, token)
    {
        if (pkt.getType() != "result") {
            token.fileTransfer.reject();
            return;
        }

        var xml = DOMtoE4X(pkt.getNode());
        var bsNS = new Namespace("http://oneteam.im/bs-proxy");
        var jid = xml..bsNS::connected.@jid.toString();

        var iq = new JSJaCIQ();
        iq.setIQ(token.fileTransfer.jid, "result", token.id);
        iq.getNode().appendChild(E4XtoDOM(
            <query xmlns='http://jabber.org/protocol/bytestreams'>
                <streamhost-used jid={jid}/>
            </query>, pkt.getDoc()));

        account.connection.send(iq);
        this.transfersBySidHash[token.sidHash] = token.fileTransfer;
        token.fileTransfer.onTransferStart();
    }
}

var socks5Service = new SOCKS5Service();

servicesManager.addIQService("http://jabber.org/protocol/bytestreams",
                             new Callback(socks5Service.onSocksIQ, socks5Service));
servicesManager.addIQService("http://oneteam.im/bs-proxy",
                             new Callback(socks5Service.onBSIQ, socks5Service));
