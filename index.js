const express = require('express');
const cors = require('cors');
const paydunya = require('paydunya');
const crypto = require('crypto'); // Requis pour le hash SHA-512 de l'IPN
require('dotenv').config();

const app = express();

// 1. Activer CORS et le parsing JSON et URL-Encoded (Requis pour PayDunya)
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // PayDunya poste les données IPN sous ce format

// 2. Initialiser le Setup PayDunya
const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test'
});

// 3. Initialiser le Store PayDunya (Correction des clés en camelCase)
const store = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Vente de livres en ligne",
    postalAddress: "Adresse de la boutique", // Corrigé : postalAddress
    phoneNumber: "Numéro de téléphone",      // Corrigé : phoneNumber
    websiteURL: "https://ika-book.com",      // Corrigé : websiteURL
    logoURL: "https://ika-book.com/logo.png",// Corrigé : logoURL
    // URL globale où PayDunya enverra les notifications de paiement (IPN)
    callbackURL: "https://ika-book-backend.onrender.com/webhook" 
});

// 4. Route pour la création de facture
app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient } = req.body;

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        
        invoice.addItem(description || "Achat Ika-Book", 1, montant, montant);
        invoice.totalAmount = montant;

        const success = await invoice.create();

        if (success) {
            res.json({
                success: true,
                invoice_url: invoice.invoice_url,
                token: invoice.token
            });
        } else {
            console.log("Erreur PayDunya détaillée :", invoice); 

            res.status(400).json({
                success: false,
                message: invoice.response_text || "Erreur lors de la création de la facture"
            });
        }
    } catch (error) {
        console.error("Erreur serveur:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. Route IPN (Instant Payment Notification) pour la confirmation des paiements
app.post('/webhook', (req, res) => {
    try {
        // La structure renvoyée se trouve sous l'index "data"
        const data = req.body.data;
        
        if (!data) {
            return res.status(400).send("Aucune donnée reçue");
        }

        const status = data.status;
        const hash = data.hash;
        const invoice = data.invoice;

        // Création du Hash SHA-512 de votre MasterKey
        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
            .digest('hex');

        // Comparaison du hash généré avec celui reçu
        if (hash === masterKeyHash) {
            if (status === "completed") {
                // Le paiement est confirmé avec succès
                // TODO: Mettez à jour le statut de la commande de votre client dans votre base de données ici
                console.log(`Paiement de ${invoice.total_amount} FCFA complété avec succès !`);
            }
            // Répondre à PayDunya que la notification a bien été reçue
            res.status(200).send("Notification traitée");
        } else {
            console.log("Alerte: Cette requête n'a pas été émise par PayDunya");
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        console.error("Erreur IPN:", error);
        res.status(500).send("Erreur interne du serveur");
    }
});

// 6. Démarrer le serveur Express
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur en écoute sur le port ${PORT}`);
});
