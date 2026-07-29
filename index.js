const express = require('express');
const cors = require('cors');
const paydunya = require('paydunya');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test'
});

const store = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Vente de livres en ligne",
    postalAddress: "Adresse de la boutique",
    phoneNumber: "Numéro de téléphone",
    websiteURL: "https://ika-book.com",
    logoURL: "https://ika-book.com/logo.png",
    callbackURL: "https://api.ika-book.com/webhook"
});

const transactions = {}; 

app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem(description || "Achat Ika-Book", 1, montant, montant);
        invoice.totalAmount = montant;

        await invoice.create();

        if (invoice.url) {
            transactions[invoice.token] = {
                status: 'pending',
                userId: userId,
                metadata: metadata 
            };

            res.status(200).json({
                success: true,
                invoice_url: invoice.url,
                token: invoice.token,
                message: "Facture générée"
            });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText || "Erreur" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const data = req.body.data;
        if (!data) return res.status(400).send("Aucune donnée reçue");

        const { status, hash, invoice } = data;
        
        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
            .digest('hex');

        if (hash === masterKeyHash) {
            const currentTransaction = transactions[invoice.token];

            if (currentTransaction) {
                if (status === "completed" && currentTransaction.status !== 'completed') {
                    currentTransaction.status = 'completed';
                    
                    try {
                        const s2sResponse = await fetch("https://mobilemoney.ladjitraore5995.workers.dev/s2s/deliver", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-server-key": process.env.S2S_SECRET_KEY 
                            },
                            body: JSON.stringify({
                                metadata: currentTransaction.metadata
                            })
                        });

                        const s2sResult = await s2sResponse.json();
                        if(!s2sResponse.ok) {
                            console.error("Erreur critique lors de la livraison Worker :", s2sResult);
                        }
                    } catch (fetchError) {
                        console.error("Échec de la communication avec le Worker Cloudflare :", fetchError);
                    }
                    
                } else if (status === "cancelled") {
                    currentTransaction.status = 'cancelled';
                }
            }
            res.status(200).send("Notification traitée");
        } else {
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        res.status(500).send("Erreur interne du serveur");
    }
});

app.get('/statut-paiement/:token', (req, res) => {
    const token = req.params.token;
    const transaction = transactions[token];
    
    if (transaction) {
        res.status(200).json({ success: true, status: transaction.status });
    } else {
        res.status(404).json({ success: false, status: 'unknown' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));
