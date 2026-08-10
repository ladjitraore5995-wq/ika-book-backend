const express = require('express');
const cors = require('cors');
const paydunya = require('paydunya');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// ====================================================================
// 1. MIDDLEWARES
// ====================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route d'accueil pour éviter l'erreur "Cannot GET /" dans le navigateur
app.get('/', (req, res) => {
    res.status(200).json({ message: "L'API de paiement Ika-Book est en ligne et fonctionnelle !" });
});

// ====================================================================
// 2. CONFIGURATION PAYDUNYA
// ====================================================================
const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test'
});

const store = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Bibliothèque Virtuelle & Assistant IA Polyvalent",
    postalAddress: "Mali Bamako Rue 80, Porte 144",
    phoneNumber: "223 92837606",
    websiteUrl: "https://ika-book.com",
    logoUrl: "https://ika-book.com/Lt/1/logo.JPG",
    callbackUrl: "https://api.ika-book.com/webhook"
});

// ====================================================================
// 3. ROUTES DE PAIEMENT (ACHAT DE CRÉDITS)
// ====================================================================

app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;

        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem(description || "Achat chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;
        
        // 1. UTILISER LES CUSTOM DATA POUR SAUVEGARDER LE METADATA CHEZ PAYDUNYA
        invoice.addCustomData("userId", userId);
        invoice.addCustomData("metadata", metadata);

        await invoice.create();

        if (invoice.url) {
            // 2. AJOUTER LE TOKEN DANS L'URL DE RETOUR
            invoice.returnUrl = `https://ika-book.com/paiement-reussi?token=${invoice.token}`; 
            invoice.cancelUrl = `https://ika-book.com/paiement-annule?token=${invoice.token}`;
            
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

        const { status, hash, invoice, custom_data } = data;
        
        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
            .digest('hex');

        if (hash === masterKeyHash) {
            
            // Si le paiement est réussi
            if (status === "completed" || status === "success") {
                try {
                    // On récupère le metadata stocké chez Paydunya
                    const transactionMetadata = custom_data ? custom_data.metadata : null;

                    if (transactionMetadata) {
                        // LA CORRECTION EST ICI : Ajout de token et invoice_url
                        const s2sResponse = await fetch("https://mobilemoney.ladjitraore5995.workers.dev/s2s/deliver", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-server-key": process.env.S2S_SECRET_KEY 
                            },
                            body: JSON.stringify({
                                token: invoice.token, // L'identifiant essentiel pour arrêter la boucle du frontend
                                metadata: transactionMetadata,
                                invoice_url: invoice.receipt_url || "" // Optionnel : l'URL du reçu
                            })
                        });

                        if(!s2sResponse.ok) {
                            console.error("Erreur critique lors de la livraison Worker IA :", await s2sResponse.text());
                        }
                    }
                } catch (fetchError) {
                    console.error("Échec de la communication avec le Worker Cloudflare IA :", fetchError);
                }
            }
            res.status(200).send("Notification traitée");
        } else {
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        console.error("Erreur Webhook:", error);
        res.status(500).send("Erreur interne du serveur");
    }
});

// ====================================================================
// 4. RÉCUPÉRATION DU STATUT ET DU REÇU PDF POUR LE FRONTEND
// ====================================================================
app.get('/statut-paiement/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const invoice = new paydunya.CheckoutInvoice(setup, store);
        
        // La méthode confirm() interroge les serveurs de Paydunya pour le statut en temps réel
        const status = await invoice.confirm(token); 
        
        if (status) {
            res.status(200).json({ 
                success: true, 
                status: invoice.status, // 'completed', 'pending', 'cancelled'
                // On récupère l'URL du PDF généré par PayDunya
                receipt_url: invoice.receiptUrl || invoice.receipt_url || null
            }); 
        } else {
            res.status(404).json({ success: false, status: 'unknown' });
        }
    } catch (e) {
        res.status(500).json({ success: false, status: 'unknown', error: e.message });
    }
});
// ====================================================================
// NOUVEAUTÉ : CONFIGURATION STORES INDÉPENDANTS (PDF & PUSH)
// ====================================================================

const storePdf = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Bibliothèque Virtuelle & Assistant IA Polyvalent",
    postalAddress: "Mali Bamako Rue 80, Porte 144",
    phoneNumber: "223 92837606",
    websiteUrl: "https://ika-book.com",
    logoUrl: "https://ika-book.com/Lt/1/logo.JPG",
    callbackUrl: "https://api.ika-book.com/webhook-pdf" // Webhook 100% indépendant
});

const storePush = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Bibliothèque Virtuelle & Assistant IA Polyvalent",
    postalAddress: "Mali Bamako Rue 80, Porte 144",
    phoneNumber: "223 92837606",
    websiteUrl: "https://ika-book.com",
    logoUrl: "https://ika-book.com/Lt/1/logo.JPG",
    callbackUrl: "https://api.ika-book.com/webhook-push" // Webhook 100% indépendant
});

// ====================================================================
// ROUTE 1 : PAIEMENT PAR DISTRIBUTION (PER) PDF
// ====================================================================

app.post('/creer-paiement-pdf', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        const invoice = new paydunya.CheckoutInvoice(setup, storePdf);
        invoice.addItem(description || "Achat PDF chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;
        
        invoice.addCustomData("userId", userId);
        invoice.addCustomData("metadata", metadata);

        await invoice.create();

        if (invoice.url) {
            invoice.returnUrl = `https://ika-book.com/paiement-reussi?token=${invoice.token}`; 
            invoice.cancelUrl = `https://ika-book.com/paiement-annule?token=${invoice.token}`;
            
            res.status(200).json({
                success: true,
                invoice_url: invoice.url,
                token: invoice.token,
                message: "Facture PDF générée"
            });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText || "Erreur" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/webhook-pdf', async (req, res) => {
    try {
        const data = req.body.data;
        if (!data) return res.status(400).send("Aucune donnée reçue");

        const { status, hash, invoice, custom_data } = data;
        const masterKeyHash = crypto.createHash('sha512').update(process.env.PAYDUNYA_MASTER_KEY).digest('hex');

        if (hash === masterKeyHash) {
            if (status === "completed" || status === "success") {
                try {
                    const transactionMetadata = custom_data ? custom_data.metadata : null;
                    if (transactionMetadata) {
                        // Remplacez l'URL par l'URL exacte de votre Worker S2S pour les PDF
                        const s2sResponse = await fetch("https://pont-pdf.ladjitraore5995.workers.dev/s2s/pdf", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-server-key": process.env.S2S_SECRET_KEY 
                            },
                            body: JSON.stringify({
                                token: invoice.token,
                                metadata: transactionMetadata,
                                invoice_url: invoice.receipt_url || ""
                            })
                        });

                        if(!s2sResponse.ok) {
                            console.error("Erreur S2S PDF:", await s2sResponse.text());
                        }
                    }
                } catch (fetchError) {
                    console.error("Échec appel S2S PDF:", fetchError);
                }
            }
            res.status(200).send("Notification PDF traitée");
        } else {
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        console.error("Erreur Webhook PDF:", error);
        res.status(500).send("Erreur interne");
    }
});

// ====================================================================
// ROUTE 2 : PAIEMENT PUSH (AMBASSADEUR)
// ====================================================================

app.post('/creer-paiement-push', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        const invoice = new paydunya.CheckoutInvoice(setup, storePush);
        invoice.addItem(description || "Paiement Push chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;
        
        invoice.addCustomData("userId", userId);
        invoice.addCustomData("metadata", metadata);

        await invoice.create();

        if (invoice.url) {
            invoice.returnUrl = `https://ika-book.com/paiement-reussi?token=${invoice.token}`; 
            invoice.cancelUrl = `https://ika-book.com/paiement-annule?token=${invoice.token}`;
            
            res.status(200).json({
                success: true,
                invoice_url: invoice.url,
                token: invoice.token,
                message: "Facture Push générée"
            });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText || "Erreur" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/webhook-push', async (req, res) => {
    try {
        const data = req.body.data;
        if (!data) return res.status(400).send("Aucune donnée reçue");

        const { status, hash, invoice, custom_data } = data;
        const masterKeyHash = crypto.createHash('sha512').update(process.env.PAYDUNYA_MASTER_KEY).digest('hex');

        if (hash === masterKeyHash) {
            if (status === "completed" || status === "success") {
                try {
                    const transactionMetadata = custom_data ? custom_data.metadata : null;
                    if (transactionMetadata) {
                        // Remplacez l'URL par l'URL exacte de votre Worker S2S pour l'Ambassadeur
                        const s2sResponse = await fetch("https://ikacredit.ladjitraore5995.workers.dev/s2s/ambassadeur", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-server-key": process.env.S2S_SECRET_KEY 
                            },
                            body: JSON.stringify({
                                token: invoice.token,
                                metadata: transactionMetadata,
                                invoice_url: invoice.receipt_url || ""
                            })
                        });

                        if(!s2sResponse.ok) {
                            console.error("Erreur S2S Push/Ambassadeur:", await s2sResponse.text());
                        }
                    }
                } catch (fetchError) {
                    console.error("Échec appel S2S Push/Ambassadeur:", fetchError);
                }
            }
            res.status(200).send("Notification Push traitée");
        } else {
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        console.error("Erreur Webhook Push:", error);
        res.status(500).send("Erreur interne");
    }
});

// ====================================================================
// 5. DÉMARRAGE DU SERVEUR
// ====================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));
