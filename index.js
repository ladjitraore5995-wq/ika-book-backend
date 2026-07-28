const express = require('express');
const cors = require('cors'); // 1. Importer CORS
const paydunya = require('paydunya');
require('dotenv').config();

const app = express();

// 2. Activer CORS et le parsing JSON
app.use(cors()); 
app.use(express.json());

// 3. Initialiser le Setup PayDunya
const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test'
});

// 4. Initialiser le Store PayDunya
const store = new paydunya.Store({
    name: "Ika-Book",
    tagline: "La librairie en ligne",
    postal_address: "Bamako, Mali",
    phone_number: "+22300000000",
    website_url: "https://ika-book.com"
});

// 5. Route pour la création de facture
app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient } = req.body;

        // Injecter setup et store dans la facture
        const invoice = new paydunya.CheckoutInvoice(setup, store);

        // Configurer le montant et la description
        invoice.totalAmount = montant;
        invoice.description = description;

        // Ajouter un article pour le reçu
        invoice.addItem("Achat Ika-Book", 1, montant, montant, description);

        // Lancer la création de la facture vers l'API PayDunya
        await invoice.create();

        // Succès : Retourner le lien de paiement généré
        res.json({
            success: true,
            url: invoice.url,
            token: invoice.token
        });

    } catch (error) {
        console.error("Erreur PayDunya:", error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.data || "Aucun détail supplémentaire"
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur en cours d'exécution sur le port ${PORT}`);
});

